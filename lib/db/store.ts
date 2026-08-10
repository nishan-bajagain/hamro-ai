/**
 * JSON-file-backed telemetry store with optional shared layers.
 *
 * Replaces Prisma/SQLite so the gateway runs anywhere — a laptop, a VPS, or a
 * serverless host (Vercel, Netlify…) with zero database setup.
 *
 * How persistence works (best available wins — every layer that is available
 * is written, and reads prefer the most durable one):
 *   1. **MongoDB** (optional, recommended) — when `MONGODB_URI` is set, the
 *      full snapshot (telemetry + chats) is mirrored to a single MongoDB
 *      document and is preferred when loading. Survives serverless cold
 *      starts; no blob-size or expiry limits.
 *   2. **Vercel KV / Upstash Redis** (optional) — when `KV_REST_API_URL` and
 *      `KV_REST_API_TOKEN` are set, telemetry is also written to the shared
 *      key-value store. Implemented with plain `fetch` — no client dependency.
 *   3. **Remote JSON mirror** (optional, free, no account) — when
 *      `REMOTE_JSON_URL` is set, the snapshot is mirrored to any JSON endpoint
 *      that speaks GET/PUT (jsonblob.com, a gist-backed API, your own server…).
 *      Without `REMOTE_JSON_URL` the gateway auto-creates a free
 *      jsonblob.com blob on first write, remembers its URL in `data.json`'s
 *      `meta`, reuses it across restarts, and self-heals when the blob expires
 *      (~24h rolling window on the free tier — see README). This is what keeps
 *      `/status` alive across serverless cold starts with zero setup.
 *   4. `DATA_FILE` env var — a real writable volume (e.g. a mounted disk).
 *   5. `<project>/data.json` — local dev / VPS.
 *   6. `/tmp/hamro-data.json` — serverless hosts; per-instance, ephemeral.
 *   7. In-memory only — the gateway keeps working, telemetry just does not
 *      survive a restart.
 *
 * All mutation helpers are fire-and-forget safe: they update memory first,
 * then persist asynchronously (debounced + serialized) and never throw.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { mongoConfigured, mongoGet, mongoSet } from "./mongo.ts";

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

/** Per-model / per-provider aggregates (kept incrementally so pruning the
 *  request log never shrinks the totals, and so the compact remote snapshot
 *  can carry accurate numbers within free-blob size limits). */
export interface StoreCounters {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  failovers: number;
  errors: number;
  streaming: number;
  cached: number;
  last24hRequests: number;
  latencySum: number;
  lastUsed: string;
  perModel: Record<
    string,
    {
      requests: number;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      costUsd: number;
      failovers: number;
      latencySum: number;
      lastUsed: string;
    }
  >;
  perProvider: Record<
    string,
    {
      requests: number;
      costUsd: number;
      failovers: number;
      latencySum: number;
      lastUsed: string;
    }
  >;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** A saved conversation, stored in data.json like every other record. */
export interface ChatDoc {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  messages: ChatMessage[];
}

/**
 * Chat histories live in the same JSON database as telemetry (data.json, with
 * the optional shared mirrors) — one file, one persistence layer. Chats are
 * namespaced per API key (hashed, so raw keys never touch the file).
 */
interface StoreData {
  requests: StoredRequest[];
  providerStatus: Record<string, StoredProviderStatus>;
  chats: Record<string, ChatDoc[]>;
  nextId: number;
  /** Gateway bookkeeping (e.g. the remote JSON mirror's blob URL). */
  meta: { remoteUrl: string | null };
  /** Incremental aggregates — authoritative for totals; survives request pruning. */
  counters: StoreCounters;
}

/** Hard cap on retained request records (oldest are pruned first). */
const MAX_REQUESTS = 5_000;
/* ── chat caps (enforced at the store boundary, so every API is consistent) ── */
export const MAX_CHATS_PER_KEY = 50;
export const MAX_CHAT_MESSAGES = 200;
export const MAX_CHAT_BYTES = 200_000;
export const MAX_MESSAGE_CHARS = 8_000;
export const MAX_TITLE_CHARS = 100;
export const CHAT_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const PERSIST_DEBOUNCE_MS = 300;

let seq = 0;
function nextId(): string {
  seq += 1;
  return `${Date.now().toString(36)}-${seq.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

/* ───────────────────── Optional KV (Upstash REST) ─────────────────── */

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const KV_KEY = "hamro:telemetry";

/** Read the shared snapshot from KV, or null when unavailable/empty. */
async function kvGet(): Promise<StoreData | null> {
  if (!KV_URL || !KV_TOKEN) return null;
  try {
    const res = await fetch(`${KV_URL}/${KV_KEY}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { result?: string };
    if (typeof body.result !== "string" || !body.result) return null;
    return deserialize(body.result);
  } catch {
    // KV unreachable — fall back to file / memory.
    return null;
  }
}

/** Write the snapshot string to KV. Throws on failure (caller handles). */
async function kvSet(snapshot: string): Promise<void> {
  if (!KV_URL || !KV_TOKEN) return;
  const res = await fetch(`${KV_URL}/${KV_KEY}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    body: snapshot,
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error(`KV write failed: HTTP ${res.status}`);
}

/* ─────────────── Remote JSON mirror (free 3rd-party) ─────────────── */

const REMOTE_JSON_URL = process.env.REMOTE_JSON_URL;
// Overridable so tests can point auto-mode at a mock server.
const JSONBLOB_API = process.env.JSONBLOB_API_URL || "https://jsonblob.com/api/jsonBlob";
/** How many recent requests ride along in the compact remote snapshot. */
const REMOTE_RECENT_TAIL = 25;

/**
 * Build the compact remote snapshot. Free JSON services cap blob sizes
 * (jsonblob ≈ 10 KB), so the mirror carries accurate totals (counters),
 * provider health, and a short recent-request tail — gzip+base64'd to stay
 * well under the cap. The full request log always lives in data.json.
 */
function buildRemotePayload(data: StoreData): string {
  const compact = {
    v: 1,
    requests: data.requests.slice(-REMOTE_RECENT_TAIL),
    providerStatus: data.providerStatus,
    counters: data.counters,
    nextId: data.nextId,
    meta: data.meta,
  };
  const b64 = gzipSync(JSON.stringify(compact)).toString("base64");
  return JSON.stringify({ v: 1, gz: 1, data: b64 });
}

/** Inverse of buildRemotePayload — or null when the payload is unreadable. */
function parseRemotePayload(raw: string): Partial<StoreData> | null {
  try {
    const outer = JSON.parse(raw) as { v?: number; gz?: number; data?: string };
    const text =
      outer?.gz === 1 && typeof outer.data === "string"
        ? gunzipSync(Buffer.from(outer.data, "base64")).toString("utf8")
        : raw;
    const inner = JSON.parse(text) as {
      requests?: StoredRequest[];
      providerStatus?: Record<string, StoredProviderStatus>;
      counters?: StoreCounters;
      nextId?: number;
      meta?: { remoteUrl?: string | null };
    };
    return {
      requests: (inner.requests ?? []).map((r) => ({
        ...r,
        timestamp: new Date(r.timestamp),
      })),
      providerStatus: Object.fromEntries(
        Object.entries(inner.providerStatus ?? {}).map(([k, v]) => [
          k,
          { ...v, lastCheck: new Date(v.lastCheck) },
        ]),
      ) as Record<string, StoredProviderStatus>,
      counters: inner.counters ?? emptyCounters(),
      nextId: inner.nextId ?? 0,
      meta: { remoteUrl: inner.meta?.remoteUrl ?? null },
    };
  } catch {
    return null;
  }
}

/** Normalize a pasted jsonblob viewer URL (https://jsonblob.com/<id>) to its API URL. */
function normalizeRemoteUrl(url: string): string {
  const m = /^https:\/\/jsonblob\.com\/(?!api\/)[0-9a-f-]{36}$/i.exec(url.trim());
  return m ? `https://jsonblob.com/api/jsonBlob/${m[1]}` : url.trim();
}

async function remoteGet(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6_000) });
    if (!res.ok) return null; // 404 = expired blob
    const text = await res.text();
    return text ? text : null;
  } catch {
    return null;
  }
}

/** Create a fresh jsonblob blob. Returns the API URL, or null on failure. */
async function remoteCreate(snapshot: string): Promise<string | null> {
  try {
    const res = await fetch(JSONBLOB_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: snapshot,
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const loc = res.headers.get("location");
    return loc ? new URL(loc, JSONBLOB_API).toString() : null;
  } catch {
    return null;
  }
}

/* ────────────────────────── File resolution ───────────────────────── */

const IS_VERCEL = process.env.VERCEL === "1";

/**
 * Atomic file write: write to a temp file in the same directory, then rename
 * over the target. A crash mid-write can never leave a torn JSON file that a
 * restart would silently treat as "fresh data".
 */
async function writeFileAtomic(file: string, contents: string): Promise<void> {
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  await fs.writeFile(tmp, contents, "utf8");
  await fs.rename(tmp, file);
}

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
  // An explicit DATA_FILE (mounted volume) is always tried first.
  if (process.env.DATA_FILE) {
    return (await isWritable(process.env.DATA_FILE)) ? process.env.DATA_FILE : null;
  }
  // On Vercel the project directory is read-only, so probing <cwd>/data.json
  // just wastes a cold-start write attempt; go straight to /tmp (which is
  // per-instance and ephemeral — KV is the durable layer there).
  const candidates = IS_VERCEL
    ? ["/tmp/hamro-data.json"]
    : [path.join(process.cwd(), "data.json"), "/tmp/hamro-data.json"];
  for (const file of candidates) {
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
  return {
    requests: [],
    providerStatus: {},
    chats: {},
    nextId: 0,
    meta: { remoteUrl: null },
    counters: emptyCounters(),
  };
}

function emptyCounters(): StoreCounters {
  return {
    requests: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    failovers: 0,
    errors: 0,
    streaming: 0,
    cached: 0,
    last24hRequests: 0,
    latencySum: 0,
    lastUsed: "",
    perModel: {},
    perProvider: {},
  };
}

/** Rebuild counters from a request log (used to backfill old snapshots). */
function countersFromRequests(requests: StoredRequest[]): StoreCounters {
  const c = emptyCounters();
  const since = Date.now() - 24 * 60 * 60 * 1000;
  for (const r of requests) {
    c.requests += 1;
    c.promptTokens += r.promptTokens;
    c.completionTokens += r.completionTokens;
    c.totalTokens += r.totalTokens;
    c.costUsd += r.costUsd;
    c.failovers += r.failovers;
    if (r.statusCode !== 200) c.errors += 1;
    if (r.stream) c.streaming += 1;
    if (r.cached) c.cached += 1;
    c.latencySum += r.latencyMs;
    if (r.timestamp.getTime() >= since) c.last24hRequests += 1;
    const ts = r.timestamp.toISOString();
    if (ts > c.lastUsed) c.lastUsed = ts;

    const m = (c.perModel[r.servedModel] ??= {
      requests: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      failovers: 0,
      latencySum: 0,
      lastUsed: "",
    });
    m.requests += 1;
    m.promptTokens += r.promptTokens;
    m.completionTokens += r.completionTokens;
    m.totalTokens += r.totalTokens;
    m.costUsd += r.costUsd;
    m.failovers += r.failovers;
    m.latencySum += r.latencyMs;
    if (ts > m.lastUsed) m.lastUsed = ts;

    const p = (c.perProvider[r.provider] ??= {
      requests: 0,
      costUsd: 0,
      failovers: 0,
      latencySum: 0,
      lastUsed: "",
    });
    p.requests += 1;
    p.costUsd += r.costUsd;
    p.failovers += r.failovers;
    p.latencySum += r.latencyMs;
    if (ts > p.lastUsed) p.lastUsed = ts;
  }
  return c;
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
      meta: { remoteUrl: parsed.meta?.remoteUrl ?? null },
      counters: parsed.counters
        ? (parsed.counters as StoreCounters)
        : countersFromRequests(
            (Array.isArray(parsed.requests) ? parsed.requests : []) as StoredRequest[],
          ),
      chats:
        parsed.chats && typeof parsed.chats === "object"
          ? (Object.fromEntries(
              Object.entries(parsed.chats as Record<string, ChatDoc[]>).map(
                ([owner, list]) => [
                  owner,
                  (Array.isArray(list) ? list : []).map((c) => ({
                    ...c,
                    createdAt: new Date(c.createdAt),
                    updatedAt: new Date(c.updatedAt),
                    messages: Array.isArray(c.messages) ? c.messages : [],
                  })),
                ],
              ),
            ) as Record<string, ChatDoc[]>)
          : {},
    };
  } catch {
    return emptyData();
  }
}

/* ────────────────────────── Store singleton ───────────────────────── */

class JsonStore {
  private data: StoreData = emptyData();
  private file: string | null = null;
  /** Single shared init promise so concurrent first calls never race. */
  private initPromise: Promise<void> | null = null;
  private persistTimer: NodeJS.Timeout | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private warned = false;
  /** Back off remote attempts briefly after a failed create (rate limits). */
  private remoteCooldownUntil = 0;
  /** Throttle mirror writes (free-tier rate limits); file writes are unaffected. */
  private lastRemoteWriteAt = 0;
  private static REMOTE_WRITE_INTERVAL_MS = 10_000;

  /** Log a warning once (per process) so flaky backends don't spam. */
  private warnOnce(message: string): void {
    if (!this.warned) {
      console.warn(message);
      this.warned = true;
    }
  }

  /**
   * Lazily initialize once. The promise is stored so parallel first requests
   * (a cold-start burst) all await the SAME probe — otherwise `file` could be
   * assigned after a concurrent caller already skipped persistence.
   */
  private ensureLoaded(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.init();
    }
    return this.initPromise;
  }

  private async init(): Promise<void> {
    // 0. MongoDB — most durable shared layer when configured (survives
    //    serverless cold starts, no size/expiry limits).
    if (mongoConfigured()) {
      const mongoData = await mongoGet();
      if (mongoData) {
        this.data = deserialize(mongoData);
        // Keep a per-instance file too, as a warm cache / offline fallback.
        this.file = await pickWritablePath();
        return;
      }
    }
    // 1. Shared KV snapshot (Vercel KV / Upstash) — next most durable.
    if (KV_URL && KV_TOKEN) {
      const kvData = await kvGet();
      if (kvData) {
        this.data = kvData;
        // Keep a per-instance file too, as a warm cache / offline fallback.
        this.file = await pickWritablePath();
        return;
      }
    }
    // 2. Local file (volume → project data.json → /tmp). The file is the
    //    primary source of truth locally; a torn/empty read must never silently
    //    wipe telemetry, so log it (the remote backfill below recovers).
    this.file = await pickWritablePath();
    if (this.file) {
      try {
        this.data = deserialize(await fs.readFile(this.file, "utf8"));
      } catch (e) {
        if (!this.warned) {
          console.warn(
            "[store] telemetry file unreadable, starting fresh:",
            (e as Error)?.message ?? e,
          );
          this.warned = true;
        }
        this.data = emptyData();
      }
    }
    // 3. Remote JSON backfill — only when the local data is missing or stale
    //    (e.g. a fresh serverless instance whose /tmp was wiped, or a torn
    //    local file). The compact mirror carries accurate totals.
    const remoteUrl = REMOTE_JSON_URL
      ? normalizeRemoteUrl(REMOTE_JSON_URL)
      : this.data.meta.remoteUrl;
    if (remoteUrl) {
      const raw = await remoteGet(remoteUrl);
      if (raw) {
        const loaded = parseRemotePayload(raw);
        if (loaded && loaded.counters!.requests > this.data.counters.requests) {
          this.data = {
            ...emptyData(),
            ...loaded,
            chats: this.data.chats, // chats are not mirrored remotely
          };
        }
      }
    }
    if (!this.file && !(KV_URL && KV_TOKEN)) {
      if (!this.warned) {
        console.warn(
          "[store] no persistent storage found (KV not configured, no writable filesystem) — " +
            "telemetry kept in memory only (expected on serverless hosts without KV).",
        );
        this.warned = true;
      }
    }
  }

  /** Serialize writes so concurrent log calls can never corrupt the file. */
  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      if (
        !this.file &&
        !(KV_URL && KV_TOKEN) &&
        !mongoConfigured() &&
        !REMOTE_JSON_URL &&
        !this.data.meta.remoteUrl
      ) {
        return;
      }
      const snapshot = JSON.stringify(this.data);
      this.writeChain = this.writeChain
        .then(async () => {
          // Every layer is written independently — a MongoDB / KV / remote
          // outage must never block the file write (the file is the primary
          // local source of truth). Each optional layer swallows its own
          // errors so `Promise.all` cannot reject.
          const writes: Promise<unknown>[] = [];
          if (this.file)
            writes.push(
              writeFileAtomic(this.file as string, snapshot).catch((e) => {
                this.warnOnce(`[store] file write failed: ${e?.message ?? e}`);
              }),
            );
          if (mongoConfigured())
            writes.push(
              mongoSet(snapshot).catch((e) => {
                this.warnOnce(`[store] MongoDB write failed: ${e?.message ?? e}`);
              }),
            );
          if (KV_URL && KV_TOKEN)
            writes.push(
              kvSet(snapshot).catch((e) => {
                this.warnOnce(`[store] KV write failed: ${e?.message ?? e}`);
              }),
            );
          await Promise.all(writes);
          await this.persistRemote();
        })
        .catch((e) => {
          this.warnOnce(`[store] persist failed: ${e?.message ?? e}`);
        });
    }, PERSIST_DEBOUNCE_MS);
  }

  /**
   * Mirror the snapshot to the remote JSON backend. With an explicit
   * REMOTE_JSON_URL, PUT to it. Otherwise use jsonblob auto-mode: PUT to the
   * remembered blob URL and, if the blob expired (404), create a fresh one and
   * remember it in `meta` (a follow-up persist flushes the URL to file/KV).
   */
  private async persistRemote(): Promise<void> {
    const payload = buildRemotePayload(this.data);
    if (REMOTE_JSON_URL) {
      try {
        const res = await fetch(normalizeRemoteUrl(REMOTE_JSON_URL), {
          method: "PUT",
          body: payload,
          signal: AbortSignal.timeout(8_000),
        });
        if (res.ok) {
          this.lastRemoteWriteAt = Date.now();
        } else if (!this.warned) {
          console.warn(`[store] remote JSON PUT failed (HTTP ${res.status}) — check REMOTE_JSON_URL.`);
          this.warned = true;
        }
      } catch {
        /* transient network failure — retried on the next persist */
      }
      return;
    }

    // Back off briefly after a failed blob create (e.g. provider rate limit)
    // instead of hammering the API once per persist.
    if (Date.now() < this.remoteCooldownUntil) return;
    // Throttle: the file layer persists every change; the remote mirror only
    // needs to stay fresh within ~10s, which keeps free tiers happy.
    const now = Date.now();
    if (now - this.lastRemoteWriteAt < JsonStore.REMOTE_WRITE_INTERVAL_MS) return;

    const url = this.data.meta.remoteUrl;
    if (url) {
      try {
        const res = await fetch(url, {
          method: "PUT",
          body: payload,
          signal: AbortSignal.timeout(8_000),
        });
        if (res.ok) {
          this.lastRemoteWriteAt = Date.now();
          return;
        }
        // Only an expired/missing blob (404) triggers recreation — rate limits
        // (429) and server errors are transient, so just retry next persist.
        if (res.status !== 404 && res.status !== 410) return;
      } catch {
        return; // transient — keep the URL for next time
      }
    }
    const created = await remoteCreate(payload);
    if (created) {
      this.data.meta.remoteUrl = created;
      this.lastRemoteWriteAt = Date.now();
      // Flush the new blob URL into file/KV so restarts can find it.
      this.schedulePersist();
    } else {
      this.remoteCooldownUntil = Date.now() + 5 * 60_000;
    }
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

  /** Incremental aggregates (authoritative totals — see StoreCounters). */
  async counters(): Promise<StoreCounters> {
    await this.ensureLoaded();
    return this.data.counters;
  }

  /* ── writes (never throw) ── */

  async addRequest(input: Omit<StoredRequest, "id" | "timestamp">): Promise<void> {
    await this.ensureLoaded();
    const rec: StoredRequest = { id: nextId(), timestamp: new Date(), ...input };
    this.data.requests.push(rec);
    if (this.data.requests.length > MAX_REQUESTS) {
      this.data.requests.splice(0, this.data.requests.length - MAX_REQUESTS);
    }
    this.updateCounters(rec);
    this.schedulePersist();
  }

  /** Fold one request into the incremental aggregates. */
  private updateCounters(r: StoredRequest): void {
    const c = this.data.counters;
    c.requests += 1;
    c.promptTokens += r.promptTokens;
    c.completionTokens += r.completionTokens;
    c.totalTokens += r.totalTokens;
    c.costUsd += r.costUsd;
    c.failovers += r.failovers;
    if (r.statusCode !== 200) c.errors += 1;
    if (r.stream) c.streaming += 1;
    if (r.cached) c.cached += 1;
    c.latencySum += r.latencyMs;
    const now = Date.now();
    if (r.timestamp.getTime() >= now - 24 * 60 * 60 * 1000) c.last24hRequests += 1;
    const ts = r.timestamp.toISOString();
    if (ts > c.lastUsed) c.lastUsed = ts;

    const m = (c.perModel[r.servedModel] ??= {
      requests: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      failovers: 0,
      latencySum: 0,
      lastUsed: "",
    });
    m.requests += 1;
    m.promptTokens += r.promptTokens;
    m.completionTokens += r.completionTokens;
    m.totalTokens += r.totalTokens;
    m.costUsd += r.costUsd;
    m.failovers += r.failovers;
    m.latencySum += r.latencyMs;
    if (ts > m.lastUsed) m.lastUsed = ts;

    const p = (c.perProvider[r.provider] ??= {
      requests: 0,
      costUsd: 0,
      failovers: 0,
      latencySum: 0,
      lastUsed: "",
    });
    p.requests += 1;
    p.costUsd += r.costUsd;
    p.failovers += r.failovers;
    p.latencySum += r.latencyMs;
    if (ts > p.lastUsed) p.lastUsed = ts;
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

  /* ── chats (the data.json database) ── */

  /** All chats owned by `owner`, oldest first (matches the client's list). */
  async chatsFor(owner: string): Promise<ChatDoc[]> {
    await this.ensureLoaded();
    return (this.data.chats[owner] ?? []).map((c) => ({
      ...c,
      createdAt: new Date(c.createdAt),
      updatedAt: new Date(c.updatedAt),
      messages: c.messages.map((m) => ({ ...m })),
    }));
  }

  /**
   * Validate + save a chat. Creating (no id) or replacing (existing id).
   * Enforces every cap here so all callers get identical, secure behavior.
   */
  async upsertChat(
    owner: string,
    input: {
      id?: string;
      title?: unknown;
      messages?: unknown;
    },
  ): Promise<{ ok: true; doc: ChatDoc } | { ok: false; error: string }> {
    await this.ensureLoaded();

    if (input.id !== undefined && !CHAT_ID_PATTERN.test(String(input.id))) {
      return { ok: false, error: "Invalid chat id." };
    }
    const title =
      typeof input.title === "string" ? input.title.trim().slice(0, MAX_TITLE_CHARS) : "Chat";
    if (!Array.isArray(input.messages) || input.messages.length === 0) {
      return { ok: false, error: "`messages` must be a non-empty array." };
    }
    if (input.messages.length > MAX_CHAT_MESSAGES) {
      return { ok: false, error: `A chat can hold at most ${MAX_CHAT_MESSAGES} messages.` };
    }
    const messages: ChatMessage[] = [];
    for (const m of input.messages) {
      if (!m || typeof m !== "object" || typeof (m as { role?: unknown }).role !== "string") {
        return { ok: false, error: "Each message must have a `role`." };
      }
      const role = (m as { role: string }).role;
      if (!["system", "user", "assistant"].includes(role)) {
        return { ok: false, error: `Unsupported message role: '${role}'.` };
      }
      const content = (m as { content?: unknown }).content;
      if (typeof content !== "string") {
        return { ok: false, error: "Each message must have string `content`." };
      }
      if (content.length > MAX_MESSAGE_CHARS) {
        return { ok: false, error: `A single message can be at most ${MAX_MESSAGE_CHARS} characters.` };
      }
      messages.push({ role: role as ChatMessage["role"], content });
    }

    const list = this.data.chats[owner] ?? [];
    const now = new Date();
    let doc: ChatDoc;
    const existingIndex = input.id ? list.findIndex((c) => c.id === input.id) : -1;
    if (existingIndex !== -1) {
      doc = {
        ...list[existingIndex],
        title,
        updatedAt: now,
        messages,
      };
      list[existingIndex] = doc;
    } else {
      if (list.length >= MAX_CHATS_PER_KEY) {
        return { ok: false, error: `You can store at most ${MAX_CHATS_PER_KEY} chats. Delete some first.` };
      }
      doc = {
        id: input.id ?? `chat_${nextId()}`,
        title,
        createdAt: now,
        updatedAt: now,
        messages,
      };
      list.push(doc);
    }
    if (Buffer.byteLength(JSON.stringify(doc), "utf8") > MAX_CHAT_BYTES) {
      return { ok: false, error: `A chat can be at most ${MAX_CHAT_BYTES} bytes.` };
    }
    this.data.chats[owner] = list;
    this.schedulePersist();
    return {
      ok: true,
      doc: { ...doc, createdAt: new Date(doc.createdAt), updatedAt: new Date(doc.updatedAt), messages: doc.messages.map((m) => ({ ...m })) },
    };
  }

  /** Delete one chat. Returns false when it did not exist. */
  async deleteChat(owner: string, id: string): Promise<boolean> {
    await this.ensureLoaded();
    const list = this.data.chats[owner] ?? [];
    const idx = list.findIndex((c) => c.id === id);
    if (idx === -1) return false;
    list.splice(idx, 1);
    this.data.chats[owner] = list;
    this.schedulePersist();
    return true;
  }

  /** Delete every chat owned by `owner`. */
  async clearChats(owner: string): Promise<void> {
    await this.ensureLoaded();
    if (this.data.chats[owner]?.length) {
      this.data.chats[owner] = [];
      this.schedulePersist();
    }
  }
}

/** Process-wide singleton. */
const store = new JsonStore();
export { store };
