/**
 * MongoDB persistence layer for the gateway's telemetry + chats snapshot.
 *
 * When `MONGODB_URI` is set, the store mirrors its full JSON snapshot to a
 * single MongoDB document (upserted on every persist) and prefers MongoDB as
 * the most durable source when loading on startup. Unlike the free jsonblob
 * mirror it has no 10 KB blob cap and no 24 h expiry, and unlike the local
 * file it survives serverless cold starts — so it is the recommended durable
 * layer for /status and chat history on Vercel.
 *
 * The client is a module-level singleton (cached across warm invocations),
 * with short selection/connect timeouts so an unreachable cluster degrades to
 * the file / memory layers instead of stalling a request.
 */

import { MongoClient } from "mongodb";

const URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || "hamro";
const COLLECTION = "store";
const DOC_ID = "telemetry";

let clientPromise: Promise<MongoClient> | null = null;
/** Back off connection attempts briefly after a failure so an unreachable
 *  cluster (wrong credentials, DNS/SRV blocked, cluster down) can't stall the
 *  store's persist chain on every write. */
let cooldownUntil = 0;
const COOLDOWN_MS = 60_000;
/** Skip the Mongo mirror when the snapshot would exceed a Mongo document
 *  (16 MB hard cap); the file / KV / remote layers still persist it. */
const MAX_DOC_BYTES = 12 * 1024 * 1024;
let warnedOversize = false;

export function mongoConfigured(): boolean {
  return Boolean(URI && URI.startsWith("mongodb"));
}

async function getClient(): Promise<MongoClient> {
  if (!URI) throw new Error("MONGODB_URI not configured");
  if (Date.now() < cooldownUntil) throw new Error("MongoDB in cooldown after a failed connect");
  if (!clientPromise) {
    clientPromise = new MongoClient(URI, {
      serverSelectionTimeoutMS: 5_000,
      connectTimeoutMS: 5_000,
    })
      .connect()
      .catch((e) => {
        // A failed connect (wrong credentials, cluster down, transient network)
        // must not permanently poison the cached client — reset so the next
        // persist retries, but not before the cooldown elapses.
        clientPromise = null;
        cooldownUntil = Date.now() + COOLDOWN_MS;
        throw e;
      });
  }
  return clientPromise;
}

/** Read the stored snapshot string, or null when unset / unreachable. */
export async function mongoGet(): Promise<string | null> {
  if (!mongoConfigured()) return null;
  try {
    const client = await getClient();
    const doc = await client
      .db(DB_NAME)
      .collection<{ snapshot: string }>(COLLECTION)
      .findOne({ _id: DOC_ID as never });
    return doc && typeof doc.snapshot === "string" ? doc.snapshot : null;
  } catch {
    return null; // cluster unreachable — caller falls back to file / memory
  }
}

/**
 * Upsert the full snapshot string. Throws on failure — the store's persist
 * chain catches it and keeps serving from memory (file/KV/remote still write).
 */
export async function mongoSet(snapshot: string): Promise<void> {
  if (!mongoConfigured()) return;
  if (Buffer.byteLength(snapshot, "utf8") > MAX_DOC_BYTES) {
    if (!warnedOversize) {
      console.warn(
        `[store] snapshot exceeds ${MAX_DOC_BYTES} bytes — skipping MongoDB mirror (file/KV/remote layers still persist).`,
      );
      warnedOversize = true;
    }
    return;
  }
  const client = await getClient();
  await client
    .db(DB_NAME)
    .collection(COLLECTION)
    .replaceOne(
      { _id: DOC_ID as never },
      { _id: DOC_ID, snapshot, updatedAt: new Date() } as never,
      { upsert: true },
    );
}
