/**
 * JSON-file-backed telemetry store.
 *
 * Replaces Prisma/SQLite so the gateway runs anywhere — a laptop, a VPS, or a
 * serverless host (Vercel, Netlify…) with zero database setup.
 *
 * How persistence works:
 *   1. The store picks the first *writable* location in this order:
 *        DATA_FILE env var  →  <project>/data.json  →  /tmp/hamro-data.json
 *   2. On hosts with a read-only filesystem (serverless) it transparently
 *      falls back to in-memory storage, so the gateway keeps working — the
 *      only cost is that telemetry does not survive a cold restart.
 *
 * All mutation helpers are fire-and-forget safe: they update memory first,
 * then persist asynchronously (debounced + serialized) and never throw.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

export interface StoredRequest {
  id: string;
  timestamp: Date;
  requestedModel: string;
  servedModel: string;
  provider: string;
  statusCode: number;
  stream: boolean;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  latencyMs: number;
  ttftMs: number | null;
  failovers: number;
  error: string | null;
  client: string | null;
  /** True when the response was served from the deterministic-response cache. */
  cached: boolean;
}

export type ProviderStatusValue = "online" | "degraded" | "offline" | "unknown";

export interface StoredProviderStatus {
  provider: string;
  status: ProviderStatusValue;
  latencyMs: number | null;
  successes: number;
  failures: number;
  lastCheck: Date;
  lastError: string | null;
  lastModel: string | null;
}

interface StoreData {
  requests: StoredRequest[];
  providerStatus: Record<string, StoredProviderStatus>;
  nextId: number;
}

/** Hard cap on retained request records (oldest are pruned first). */
const MAX_REQUESTS = 5_000;
const PERSIST_DEBOUNCE_MS = 300;

let seq = 0;
function nextId(): string {
  seq += 1;
  return `${Date.now().toString(36)}-${seq.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

/* ────────────────────────── File resolution ───────────────────────── */

const CANDIDATE_PATHS = (): string[] => {
  const paths: string[] = [];
  if (process.env.DATA_FILE) paths.push(process.env.DATA_FILE);
  paths.push(path.join(process.cwd(), "data.json"));
  paths.push("/tmp/hamro-data.json");
  return paths;
};

async function isWritable(file: string): Promise<boolean> {
  try {
    // Existing file: open read-write — proves we can write, touches nothing.
    const fh = await fs.open(file, "r+");
    await fh.close();
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      // Missing file: probe creation instead (read-only mounts fail here).
      try {
        await fs.writeFile(file, "{}", { flag: "wx" });
        await fs.rm(file);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

async function pickWritablePath(): Promise<string | null> {
  for (const file of CANDIDATE_PATHS()) {
    try {
      await fs.access(path.dirname(file));
      if (await isWritable(file)) return file;
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

/* ────────────────────────── Load / save ───────────────────────────── */

function emptyData(): StoreData {
  return { requests: [], providerStatus: {}, nextId: 0 };
}

function deserialize(raw: string): StoreData {
  try {
    const parsed = JSON.parse(raw) as Partial<StoreData>;
    return {
      requests: Array.isArray(parsed.requests)
        ? (parsed.requests as StoredRequest[]).map((r) => ({
            ...r,
            timestamp: new Date(r.timestamp),
          }))
        : [],
      providerStatus:
        parsed.providerStatus && typeof parsed.providerStatus === "object"
          ? (Object.fromEntries(
              Object.entries(parsed.providerStatus as Record<string, StoredProviderStatus>).map(
                ([k, v]) => [k, { ...v, lastCheck: new Date(v.lastCheck) }],
              ),
            ) as Record<string, StoredProviderStatus>)
          : {},
      nextId: typeof parsed.nextId === "number" ? parsed.nextId : 0,
    };
  } catch {
    return emptyData();
  }
}

/* ────────────────────────── Store singleton ───────────────────────── */

class JsonStore {
  private data: StoreData = emptyData();
  private file: string | null = null;
  private loaded = false;
  private persistTimer: NodeJS.Timeout | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private warned = false;

  /** Lazily load existing data from disk once. */
  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    this.file = await pickWritablePath();
    if (!this.file) {
      if (!this.warned) {
        console.warn(
          "[store] no writable filesystem detected — telemetry kept in memory only " +
            "(expected on serverless hosts; set DATA_FILE to a writable path to persist).",
        );
        this.warned = true;
      }
      return;
    }
    try {
      const raw = await fs.readFile(this.file, "utf8");
      this.data = deserialize(raw);
    } catch {
      this.data = emptyData();
    }
  }

  /** Serialize writes so concurrent log calls can never corrupt the file. */
  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      if (!this.file) return;
      const snapshot = JSON.stringify(this.data);
      this.writeChain = this.writeChain
        .then(async () => {
          await fs.writeFile(this.file as string, snapshot, "utf8");
        })
        .catch((e) => {
          // Filesystem became unwritable (e.g. host switched to read-only):
          // downgrade to memory-only and keep serving.
          if (!this.warned) {
            console.warn("[store] persist failed, keeping telemetry in memory:", e?.message ?? e);
            this.warned = true;
          }
        });
    }, PERSIST_DEBOUNCE_MS);
  }

  /* ── reads ── */

  async requests(): Promise<StoredRequest[]> {
    await this.ensureLoaded();
    return this.data.requests;
  }

  async providerStatuses(): Promise<StoredProviderStatus[]> {
    await this.ensureLoaded();
    return Object.values(this.data.providerStatus);
  }

  /* ── writes (never throw) ── */

  async addRequest(input: Omit<StoredRequest, "id" | "timestamp">): Promise<void> {
    await this.ensureLoaded();
    this.data.requests.push({ id: nextId(), timestamp: new Date(), ...input });
    if (this.data.requests.length > MAX_REQUESTS) {
      this.data.requests.splice(0, this.data.requests.length - MAX_REQUESTS);
    }
    this.schedulePersist();
  }

  async upsertProviderStatus(
    provider: string,
    patch: Partial<StoredProviderStatus>,
  ): Promise<void> {
    await this.ensureLoaded();
    const prev = this.data.providerStatus[provider];
    const defaults: StoredProviderStatus = {
      provider,
      status: "unknown",
      latencyMs: null,
      successes: 0,
      failures: 0,
      lastCheck: new Date(),
      lastError: null,
      lastModel: null,
    };
    const merged: StoredProviderStatus = { ...defaults, ...prev, ...patch };
    merged.provider = provider;
    merged.lastCheck = new Date();
    this.data.providerStatus[provider] = merged;
    this.schedulePersist();
  }
}

/** Process-wide singleton. */
const store = new JsonStore();
export { store };
