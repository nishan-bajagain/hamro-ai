/**
 * Bounded in-memory TTL cache for deterministic (temperature=0, non-streaming)
 * chat completions. Repeated identical agent calls — retries, re-runs of the
 * same tool — are served instantly without burning upstream quota.
 *
 * Env config:
 *   CACHE_TTL_SECONDS  seconds a cached completion lives (default 60, 0 disables)
 *   CACHE_MAX_ENTRIES  max entries before LRU eviction (default 200)
 */

function configuredTtl(): number {
  const raw = process.env.CACHE_TTL_SECONDS;
  if (raw === undefined) return 60;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export const CACHE_TTL_MS = configuredTtl() * 1000;
const MAX_ENTRIES = Number.parseInt(process.env.CACHE_MAX_ENTRIES ?? "200", 10) || 200;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

export function cacheGet<T>(key: string): T | undefined {
  if (CACHE_TTL_MS === 0) return undefined;
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  // LRU touch: re-insert to keep most-recently-used at the end.
  cache.delete(key);
  cache.set(key, entry);
  return entry.value as T;
}

export function cacheSet(key: string, value: unknown): void {
  if (CACHE_TTL_MS === 0) return;
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

export function cacheClear(): void {
  cache.clear();
}
