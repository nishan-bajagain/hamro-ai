/**
 * Lightweight in-memory sliding-window rate limiter for the gateway.
 *
 * Env config:
 *   RATE_LIMIT_RPM   max requests per minute per key (default 120, 0 disables)
 *
 * State is per-process — good enough for a single instance (VPS, one Vercel
 * lambda). For multi-instance deploy, swap this for a shared store.
 */

const WINDOW_MS = 60_000;

function configuredRpm(): number {
  const raw = process.env.RATE_LIMIT_RPM;
  if (raw === undefined) return 120;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export const RATE_LIMIT_RPM = configuredRpm();

const buckets = new Map<string, number[]>();
let lastSweep = Date.now();

// Periodic cleanup to prevent memory leaks when no requests come in
if (typeof setInterval === "function") {
  setInterval(() => {
    const now = Date.now();
    sweep(now);
    lastSweep = now;
  }, WINDOW_MS).unref?.();
}

function sweep(now: number): void {
  for (const [key, hits] of buckets) {
    const kept = hits.filter((t) => now - t < WINDOW_MS);
    if (kept.length === 0) buckets.delete(key);
    else buckets.set(key, kept);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds the client should wait before retrying (0 when allowed). */
  retryAfterSeconds: number;
  remaining: number;
  limit: number;
}

export function checkRateLimit(key: string, now = Date.now()): RateLimitResult {
  if (RATE_LIMIT_RPM === 0) {
    return { allowed: true, retryAfterSeconds: 0, remaining: Number.POSITIVE_INFINITY, limit: 0 };
  }
  if (now - lastSweep > WINDOW_MS) {
    sweep(now);
    lastSweep = now;
  }
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= RATE_LIMIT_RPM) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((hits[0] + WINDOW_MS - now) / 1000),
    );
    return {
      allowed: false,
      retryAfterSeconds,
      remaining: 0,
      limit: RATE_LIMIT_RPM,
    };
  }
  hits.push(now);
  buckets.set(key, hits);
  return {
    allowed: true,
    retryAfterSeconds: 0,
    remaining: RATE_LIMIT_RPM - hits.length,
    limit: RATE_LIMIT_RPM,
  };
}
