/**
 * JSON-file-backed telemetry store with an optional shared KV layer.
 *
 * Replaces Prisma/SQLite so the gateway runs anywhere — a laptop, a VPS, or a
 * serverless host (Vercel, Netlify…) with zero database setup.
 *
 * How persistence works (best available wins):
 *   1. **Vercel KV / Upstash Redis** (optional) — when `KV_REST_API_URL` and
 *      `KV_REST_API_TOKEN` are set, telemetry is also written to the shared
 *      key-value store. This is the only backend that survives across
 *      serverless *instances*, so it's what makes `/status` show data on
 *      Vercel (each instance's filesystem, incl. `/tmp`, is ephemeral).
 *      Implemented with plain `fetch` — no client dependency.
 *   2. `DATA_FILE` env var — a real writable volume (e.g. a mounted disk).
 *   3. `<project>/data.json` — local dev / VPS.
 *   4. `/tmp/hamro-data.json` — serverless hosts; per-instance, ephemeral.
 *   5. In-memory only — the gateway keeps working, telemetry just does not
 *      survive a restart.
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
 * the optional shared-KV mirror) — one file, one persistence layer. Chats are
 * namespaced per API key (hashed, so raw keys never touch the file).
 */
interface StoreData {
  requests: StoredRequest[];
  providerStatus: Record<string, StoredProviderStatus>;
  chats: Record<string, ChatDoc[]>;
  nextId: number;
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

/* ────────────────────────── File resolution ───────────────────────── */

const IS_VERCEL = process.env.VERCEL === "1";

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
  return { requests: [], providerStatus: {}, chats: {}, nextId: 0 };
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
    // 1. Shared KV snapshot (Vercel KV / Upstash) — survives across instances.
    if (KV_URL && KV_TOKEN) {
      const kvData = await kvGet();
      if (kvData) {
        this.data = kvData;
        // Keep a per-instance file too, as a warm cache / offline fallback.
        this.file = await pickWritablePath();
        return;
      }
    }
    // 2. Writable file (volume → project data.json → /tmp).
    this.file = await pickWritablePath();
    if (!this.file) {
      if (!this.warned) {
        console.warn(
          "[store] no persistent storage found (KV not configured, no writable filesystem) — " +
            "telemetry kept in memory only (expected on serverless hosts without KV).",
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
      if (!this.file && !(KV_URL && KV_TOKEN)) return;
      const snapshot = JSON.stringify(this.data);
      this.writeChain = this.writeChain
        .then(async () => {
          const writes: Promise<unknown>[] = [];
          if (this.file) writes.push(fs.writeFile(this.file as string, snapshot, "utf8"));
          if (KV_URL && KV_TOKEN) writes.push(kvSet(snapshot));
          await Promise.all(writes);
        })
        .catch((e) => {
          // Backend became unreachable (read-only FS, KV outage): keep serving
          // from memory and stop warning repeatedly.
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
