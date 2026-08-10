import {
  getProvider,
  getConfiguredProviders,
  PROVIDERS,
  PROVIDER_IDS,
  parseFallbackChain,
  canonicalModelId,
  type ProviderConfig,
  type ProviderId,
} from "@/lib/config";
import {
  fetchChatCompletion,
  parseErrorBody,
  shouldFailover,
  toProviderError,
  buildBody,
  SseParser,
  ProviderRequestError,
} from "@/lib/ai/providers";
import {
  estimatePromptTokens,
  estimateTokens,
} from "@/lib/ai/tokens";
import {
  logRequestSafe,
  recordProviderFailure,
  recordProviderSuccess,
} from "@/lib/db/log";
import type {
  ApiErrorBody,
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionRequest,
  Usage,
} from "@/lib/ai/types";

/**
 * Smart routing & resiliency engine.
 *
 *  - Resolves a requested model to a provider (groq/…, openrouter/…, opencode/…)
 *  - Builds a fallback chain from MODEL_FALLBACK_CHAIN
 *  - Applies "sticky success": providers that recently succeeded stay at the
 *    front; providers that just failed are pushed to the back for a cooldown
 *  - Fails over on 401/403/404/429/5xx and network/timeout errors
 *  - Streams OpenAI-compatible SSE to the client, rewriting the model name,
 *    measuring TTFT, accumulating tokens and logging at completion
 */

/* ─────────────────────────── Sticky state ─────────────────────────── */

interface StickyEntry {
  failures: number;
  cooldownUntil: number;
  /** Exponentially-weighted average latency in ms (0 = unknown). */
  latencyEwma: number;
}

/**
 * NOTE — concurrency scope: this Map (like `randomPins` below, the rate
 * limiter and the response cache) is in-memory, per-process state. It is safe
 * under concurrent requests within a single Node process: JS is
 * single-threaded and every read-modify-write above is synchronous (no `await`
 * between read and write), so there are no data races. On a multi-instance /
 * serverless deployment each instance keeps its own cooldown/latency view;
 * the only consequence is that a failing provider may be attempted slightly
 * more often than strictly necessary across instances — harmless, because
 * failover is ultimately driven by real upstream errors. If cross-instance
 * coordination ever matters, move this to a shared store (e.g. Redis).
 */
const sticky = new Map<string, StickyEntry>();

const STICKY_BASE_COOLDOWN_MS = 30_000;
const STICKY_MAX_COOLDOWN_MS = 10 * 60_000; // 10 min after repeated failures

/**
 * Record a successful provider attempt. Latency feeds an EWMA used for
 * latency-aware chain ordering and adaptive timeouts.
 */
export function markProviderSuccess(providerId: string, latencyMs?: number): void {
  const e = sticky.get(providerId);
  if (e) {
    e.failures = 0;
    e.cooldownUntil = 0;
    if (latencyMs && latencyMs > 0) {
      e.latencyEwma =
        e.latencyEwma === 0 ? latencyMs : e.latencyEwma * 0.7 + latencyMs * 0.3;
    }
  } else if (latencyMs && latencyMs > 0) {
    sticky.set(providerId, { failures: 0, cooldownUntil: 0, latencyEwma: latencyMs });
  }
}

/**
 * Record a provider failure. Cooldown grows exponentially per consecutive
 * failure; an upstream `Retry-After` (429s) extends it further.
 */
export function markProviderFailure(providerId: string, retryAfterMs?: number): void {
  const now = Date.now();
  const e = sticky.get(providerId) ?? { failures: 0, cooldownUntil: 0, latencyEwma: 0 };
  e.failures += 1;
  const backoff = Math.min(
    STICKY_BASE_COOLDOWN_MS * 2 ** (e.failures - 1),
    STICKY_MAX_COOLDOWN_MS,
  );
  const extended = retryAfterMs && retryAfterMs > 0 ? Math.max(backoff, retryAfterMs) : backoff;
  const base = e.cooldownUntil > now ? e.cooldownUntil : now;
  e.cooldownUntil = base + extended;
  sticky.set(providerId, e);
}

function isProviderCoolingDown(providerId: string): boolean {
  const e = sticky.get(providerId);
  return !!e && e.cooldownUntil > Date.now();
}

/** Recent EWMA latency in ms, or undefined when unknown. */
function providerLatencyMs(providerId: string): number | undefined {
  const e = sticky.get(providerId);
  return e && e.latencyEwma > 0 ? e.latencyEwma : undefined;
}

/* ─────────────────────── Random session stickiness ────────────────── */

/**
 * `model: "random"` (alias `"auto"`) picks a random configured model the
 * first time a session asks, then pins it: every later request from the same
 * session keeps using that exact model until the session goes idle past the
 * TTL or the pinned model fails (then a fresh random model is picked).
 *
 * Sessions are keyed by `bearer + session-id` (session id = `x-session-id`
 * header, else the request `user` field, else a client fingerprint).
 */

const RANDOM_SESSION_TTL_MS =
  (Number.parseInt(process.env.RANDOM_SESSION_TTL_SECONDS ?? "3600", 10) ||
    3600) * 1000;

interface RandomPin {
  provider: ProviderId;
  model: string;
  lastUsed: number;
}

// Per-process like `sticky` — see the concurrency note above it.
const randomPins = new Map<string, RandomPin>();

/** `true` for the special "pick a random model" selectors. */
export function isRandomSelector(model: string): boolean {
  return model === "random" || model === "auto";
}

function randomPinAlive(pin: RandomPin): boolean {
  if (Date.now() - pin.lastUsed > RANDOM_SESSION_TTL_MS) return false;
  const p = getProvider(pin.provider);
  if (!p || !p.apiKey) return false;
  if (!p.models.some((m) => m.id === pin.model)) return false;
  // A pinned model whose provider is cooling down counts as failed — re-pick.
  return !isProviderCoolingDown(pin.provider);
}

function sweepRandomPins(): void {
  if (randomPins.size < 200) return;
  const now = Date.now();
  for (const [key, pin] of randomPins) {
    if (now - pin.lastUsed > RANDOM_SESSION_TTL_MS) randomPins.delete(key);
  }
}

/**
 * Return the session's pinned random model (re-picking one if the pin is
 * stale/expired/failed), or `null` when no model is configured at all.
 */
export function resolveRandomPin(
  sessionKey: string | undefined,
): ChainEntry | null {
  const key = sessionKey || "default";
  sweepRandomPins();
  const existing = randomPins.get(key);
  if (existing && randomPinAlive(existing)) {
    existing.lastUsed = Date.now();
    const p = getProvider(existing.provider);
    // Ensure the provider still has an API key configured
    if (p && p.apiKey) return { provider: p, model: existing.model };
  }

  const pool: ChainEntry[] = [];
  for (const p of getConfiguredProviders()) {
    if (isProviderCoolingDown(p.id)) continue;
    for (const m of p.models) pool.push({ provider: p, model: m.id });
  }
  if (pool.length === 0) return null;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  randomPins.set(key, {
    provider: pick.provider.id,
    model: pick.model,
    lastUsed: Date.now(),
  });
  return pick;
}

/** Drop the session's pin so the next `random` request re-picks a model. */
export function clearRandomPin(sessionKey: string | undefined): void {
  if (sessionKey) randomPins.delete(sessionKey);
}

/** True when (provider, model) is this session's pinned random model. */
function isPinnedRandom(
  sessionKey: string | undefined,
  providerId: string,
  model: string,
): boolean {
  if (!sessionKey) return false;
  const pin = randomPins.get(sessionKey);
  return !!pin && pin.provider === providerId && pin.model === model;
}

/** In-place Fisher–Yates shuffle. */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ────────────────────────── Chain resolution ──────────────────────── */

interface ChainEntry {
  provider: ProviderConfig;
  model: string;
}

interface ResolvedChain {
  candidates: ChainEntry[];
  error?: { status: number; body: ApiErrorBody };
}

function modelNotFound(model: string): ApiErrorBody {
  const available = PROVIDERS.flatMap((p) =>
    p.models.map((m) => canonicalModelId(p.id, m.id)),
  ).join(", ");
  return {
    error: {
      message: `The model '${model}' does not exist or is not configured on this gateway. Available models: ${available || "none configured"}`,
      type: "invalid_request_error",
      param: "model",
      code: "model_not_found",
    },
  };
}

/**
 * Resolve the requested model id into an ordered candidate list:
 * [requested provider/model] + [rest of MODEL_FALLBACK_CHAIN], with
 * cooling-down providers pushed to the back.
 *
 * For the `random` / `auto` selector the session's pinned model comes first
 * and the rest of the pool (shuffled, healthy providers first) serves as the
 * fallback chain — the pinned model is never swapped out unless it errors.
 */
export function resolveChain(
  requestedModel: string,
  sessionKey?: string,
): ResolvedChain {
  if (isRandomSelector(requestedModel)) {
    const pinned = resolveRandomPin(sessionKey);
    if (!pinned) {
      return {
        candidates: [],
        error: {
          status: 502,
          body: {
            error: {
              message:
                "No models are currently configured on this gateway — cannot pick a random model.",
              type: "server_error",
              param: null,
              code: "no_models_configured",
            },
          },
        },
      };
    }
    const rest: ChainEntry[] = [];
    for (const p of getConfiguredProviders()) {
      for (const m of p.models) {
        if (p.id === pinned.provider.id && m.id === pinned.model) continue;
        rest.push({ provider: p, model: m.id });
      }
    }
    shuffle(rest);
    const healthy = rest.filter((c) => !isProviderCoolingDown(c.provider.id));
    const cooling = rest.filter((c) => isProviderCoolingDown(c.provider.id));
    return { candidates: [pinned, ...healthy, ...cooling] };
  }

  const candidates: ChainEntry[] = [];
  const slash = requestedModel.indexOf("/");
  const head = slash === -1 ? "" : requestedModel.slice(0, slash);
  const forcedProvider = (PROVIDER_IDS as string[]).includes(head)
    ? (head as ProviderId)
    : undefined;
  const modelPart = forcedProvider ? requestedModel.slice(slash + 1) : requestedModel;

  if (forcedProvider) {
    const p = getProvider(forcedProvider);
    if (!p || !p.apiKey) {
      return { candidates: [], error: { status: 404, body: modelNotFound(requestedModel) } };
    }
    candidates.push({ provider: p, model: modelPart });
  } else {
    let found = false;
    for (const p of PROVIDERS) {
      const known = p.models.find((m) => m.id === modelPart);
      if (known) {
        if (!p.apiKey) {
          return { candidates: [], error: { status: 404, body: modelNotFound(requestedModel) } };
        }
        candidates.push({ provider: p, model: known.id });
        found = true;
        break;
      }
    }
    if (!found) {
      return { candidates: [], error: { status: 404, body: modelNotFound(requestedModel) } };
    }
  }

  for (const entry of parseFallbackChain()) {
    const p = getProvider(entry.provider);
    if (!p || !p.apiKey) continue;
    if (
      candidates.some(
        (c) => c.provider.id === entry.provider && c.model === entry.model,
      )
    ) {
      continue;
    }
    candidates.push({ provider: p, model: entry.model });
  }

  // Sticky ordering: requested stays first; healthy providers sorted by
  // recent EWMA latency (fastest first), then cooling-down providers last.
  const [first, ...rest] = candidates;
  const healthy = rest.filter((c) => !isProviderCoolingDown(c.provider.id));
  const cooling = rest.filter((c) => isProviderCoolingDown(c.provider.id));
  const byLatency = (a: ChainEntry, b: ChainEntry): number => {
    const la = providerLatencyMs(a.provider.id) ?? Number.POSITIVE_INFINITY;
    const lb = providerLatencyMs(b.provider.id) ?? Number.POSITIVE_INFINITY;
    return la - lb;
  };
  return { candidates: [first, ...healthy.sort(byLatency), ...cooling] };
}

/* ──────────────────────────── Timing ──────────────────────────────── */

const NON_STREAM_TIMEOUT_MS = 60_000;
const FIRST_CHUNK_BASE_TIMEOUT_MS = 20_000;
const FIRST_CHUNK_MAX_TIMEOUT_MS = 90_000;

/**
 * Adaptive first-chunk timeout: starts at 20s but grows with a provider's
 * observed latency (e.g. OpenCode free models routinely take 15s+), so slow
 * but healthy providers are not wrongly failed over.
 */
function firstChunkTimeoutFor(providerId: string): number {
  const ewma = providerLatencyMs(providerId);
  if (!ewma) return FIRST_CHUNK_BASE_TIMEOUT_MS;
  return Math.min(
    FIRST_CHUNK_MAX_TIMEOUT_MS,
    Math.max(FIRST_CHUNK_BASE_TIMEOUT_MS, ewma * 3),
  );
}

/* ────────────────────────── Non-stream path ───────────────────────── */

export type NonStreamResult =
  | {
      ok: true;
      completion: ChatCompletion;
      provider: string;
      servedModel: string;
      latencyMs: number;
      failovers: number;
      promptTokens: number;
      completionTokens: number;
      costUsd: number;
    }
  | {
      ok: false;
      aborted?: boolean;
      status: number;
      body: ApiErrorBody;
      provider?: string;
      failovers: number;
    };

export async function routeNonStream(
  req: ChatCompletionRequest,
  opts: { signal?: AbortSignal; client?: string; sessionKey?: string },
): Promise<NonStreamResult> {
  const resolved = resolveChain(req.model, opts.sessionKey);
  if (resolved.error) {
    return { ok: false, status: resolved.error.status, body: resolved.error.body, failovers: 0 };
  }

  const started = Date.now();
  let failovers = 0;
  let lastErr: ProviderRequestError | null = null;
  let lastProvider = "";

  for (const cand of resolved.candidates) {
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    opts.signal?.addEventListener("abort", onAbort);
    try {
      const res = await fetchChatCompletion(
        cand.provider,
        buildBody({ ...req, stream: false }, cand.model, cand.provider),
        AbortSignal.any([ctrl.signal, AbortSignal.timeout(NON_STREAM_TIMEOUT_MS)]),
      );

      if (!res.ok) {
        lastErr = await parseErrorBody(res);
        lastProvider = cand.provider.id;
        failovers += 1;
        markProviderFailure(
          cand.provider.id,
          lastErr.retryAfter ? lastErr.retryAfter * 1000 : undefined,
        );
        void recordProviderFailure(cand.provider.id, lastErr.message);
        if (
          isRandomSelector(req.model) &&
          isPinnedRandom(opts.sessionKey, cand.provider.id, cand.model)
        ) {
          clearRandomPin(opts.sessionKey);
        }
        if (!shouldFailover(lastErr.status)) break;
        continue;
      }

      const data = (await res.json()) as ChatCompletion;
      const completion = reshapeCompletion(data, req.model);
      const promptTokens =
        completion.usage?.prompt_tokens ?? estimatePromptTokens(req.messages);
      const completionTokens =
        completion.usage?.completion_tokens ??
        estimateTokens(completion.choices[0]?.message?.content ?? "");
      const latencyMs = Date.now() - started;

      markProviderSuccess(cand.provider.id, latencyMs);
      void recordProviderSuccess(cand.provider.id, latencyMs, cand.model);

      logRequestSafe({
        requestedModel: req.model,
        servedModel: cand.model,
        provider: cand.provider.id,
        statusCode: 200,
        stream: false,
        promptTokens,
        completionTokens,
        latencyMs,
        ttftMs: null,
        failovers,
        error: null,
        client: opts.client ?? null,
      });

      return {
        ok: true,
        completion,
        provider: cand.provider.id,
        servedModel: cand.model,
        latencyMs,
        failovers,
        promptTokens,
        completionTokens,
        costUsd: 0, // computed at log time; kept for symmetry
      };
    } catch (e) {
      if (opts.signal?.aborted) {
        return { ok: false, aborted: true, status: 499, body: abortedBody(), failovers };
      }
      lastErr = toProviderError(e);
      lastProvider = cand.provider.id;
      failovers += 1;
      markProviderFailure(
        cand.provider.id,
        lastErr.retryAfter ? lastErr.retryAfter * 1000 : undefined,
      );
      void recordProviderFailure(cand.provider.id, lastErr.message);
      if (
        isRandomSelector(req.model) &&
        isPinnedRandom(opts.sessionKey, cand.provider.id, cand.model)
      ) {
        clearRandomPin(opts.sessionKey);
      }
    } finally {
      opts.signal?.removeEventListener("abort", onAbort);
    }
  }

  const status =
    lastErr && shouldFailover(lastErr.status)
      ? lastErr.status === 429
        ? 429
        : 502
      : 502;
  logRequestSafe({
    requestedModel: req.model,
    servedModel: resolved.candidates[0]?.model ?? req.model,
    provider: lastProvider,
    statusCode: status,
    stream: false,
    promptTokens: estimatePromptTokens(req.messages),
    completionTokens: 0,
    latencyMs: Date.now() - started,
    ttftMs: null,
    failovers,
    error: lastErr?.message ?? "All providers failed",
    client: opts.client ?? null,
  });
  return {
    ok: false,
    status,
    body: errorBody(lastErr),
    provider: lastProvider,
    failovers,
  };
}

/* ─────────────────────────── Streaming path ───────────────────────── */

export type StreamStart = {
  stream: ReadableStream<Uint8Array>;
  provider: string;
  servedModel: string;
  ttftMs: number;
  failovers: number;
  promptTokens: number;
};

export type OpenStreamResult =
  | { ok: true; start: StreamStart }
  | {
      ok: false;
      aborted?: boolean;
      status: number;
      body: ApiErrorBody;
      provider?: string;
      failovers: number;
    };

type FirstEvent =
  | { type: "chunk"; payload: string }
  | { type: "end" }
  | { type: "error"; error: ProviderRequestError };

/**
 * Open a streaming completion: walk the chain until a provider produces its
 * first SSE event. Commits to that provider and returns a ReadableStream that
 * pipes the rest through. All-fail ⇒ plain error result the caller can turn
 * into a proper non-2xx response.
 */
export async function openStream(
  req: ChatCompletionRequest,
  opts: { signal?: AbortSignal; client?: string; sessionKey?: string },
): Promise<OpenStreamResult> {
  const resolved = resolveChain(req.model, opts.sessionKey);
  if (resolved.error) {
    return { ok: false, status: resolved.error.status, body: resolved.error.body, failovers: 0 };
  }

  const started = Date.now();
  const promptTokens = estimatePromptTokens(req.messages);
  let failovers = 0;
  let lastErr: ProviderRequestError | null = null;
  let lastProvider = "";

  for (const cand of resolved.candidates) {
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    opts.signal?.addEventListener("abort", onAbort);

    // First-chunk timeout: only bounds the time until the provider starts
    // streaming. Must be cleared on commit so long streams are never cut.
    const firstChunkCtrl = new AbortController();
    const firstChunkTimer = setTimeout(() => {
      firstChunkCtrl.abort(
        new DOMException("The operation was aborted due to timeout", "TimeoutError"),
      );
    }, firstChunkTimeoutFor(cand.provider.id));

    try {
      const res = await fetchChatCompletion(
        cand.provider,
        buildBody({ ...req, stream: true }, cand.model, cand.provider),
        AbortSignal.any([ctrl.signal, firstChunkCtrl.signal]),
      );

      if (!res.ok) {
        clearTimeout(firstChunkTimer);
        lastErr = await parseErrorBody(res);
        lastProvider = cand.provider.id;
        failovers += 1;
        markProviderFailure(
          cand.provider.id,
          lastErr.retryAfter ? lastErr.retryAfter * 1000 : undefined,
        );
        void recordProviderFailure(cand.provider.id, lastErr.message);
        if (
          isRandomSelector(req.model) &&
          isPinnedRandom(opts.sessionKey, cand.provider.id, cand.model)
        ) {
          clearRandomPin(opts.sessionKey);
        }
        if (!shouldFailover(lastErr.status)) break;
        continue;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        clearTimeout(firstChunkTimer);
        throw new ProviderRequestError(500, "Provider returned an empty stream body");
      }
      const parser = new SseParser();

      const first = await readFirstEvent(reader, parser, ctrl.signal);
      clearTimeout(firstChunkTimer);

      if (first.type === "error") {
        failovers += 1;
        markProviderFailure(
          cand.provider.id,
          first.error.retryAfter ? first.error.retryAfter * 1000 : undefined,
        );
        void recordProviderFailure(cand.provider.id, first.error.message);
        lastErr = first.error;
        lastProvider = cand.provider.id;
        try { reader.releaseLock(); } catch { /* ignore */ }
        if (
          isRandomSelector(req.model) &&
          isPinnedRandom(opts.sessionKey, cand.provider.id, cand.model)
        ) {
          clearRandomPin(opts.sessionKey);
        }
        if (!shouldFailover(first.error.status)) break;
        continue;
      }

      // Committed to this provider.
      const ttftMs = Date.now() - started;
      markProviderSuccess(cand.provider.id, ttftMs);
      void recordProviderSuccess(cand.provider.id, ttftMs, cand.model);

      const stream =
        first.type === "chunk"
          ? pipeStream({
              reader,
              parser,
              firstPayload: first.payload,
              req,
              providerId: cand.provider.id,
              servedModel: cand.model,
              started,
              ttftMs,
              failovers,
              client: opts.client ?? null,
            })
          : emptyStream({
              req,
              providerId: cand.provider.id,
              servedModel: cand.model,
              started,
              failovers,
              client: opts.client ?? null,
            });

      return {
        ok: true,
        start: {
          stream,
          provider: cand.provider.id,
          servedModel: cand.model,
          ttftMs,
          failovers,
          promptTokens,
        },
      };
    } catch (e) {
      clearTimeout(firstChunkTimer);
      if (opts.signal?.aborted) {
        return { ok: false, aborted: true, status: 499, body: abortedBody(), failovers };
      }
      lastErr = toProviderError(e);
      lastProvider = cand.provider.id;
      failovers += 1;
      markProviderFailure(
        cand.provider.id,
        lastErr.retryAfter ? lastErr.retryAfter * 1000 : undefined,
      );
      void recordProviderFailure(cand.provider.id, lastErr.message);
      if (
        isRandomSelector(req.model) &&
        isPinnedRandom(opts.sessionKey, cand.provider.id, cand.model)
      ) {
        clearRandomPin(opts.sessionKey);
      }
    } finally {
      opts.signal?.removeEventListener("abort", onAbort);
    }
  }

  const status =
    lastErr && shouldFailover(lastErr.status)
      ? lastErr.status === 429
        ? 429
        : 502
      : 502;
  logRequestSafe({
    requestedModel: req.model,
    servedModel: resolved.candidates[0]?.model ?? req.model,
    provider: lastProvider,
    statusCode: status,
    stream: true,
    promptTokens,
    completionTokens: 0,
    latencyMs: Date.now() - started,
    ttftMs: null,
    failovers,
    error: lastErr?.message ?? "All providers failed",
    client: opts.client ?? null,
  });
  return {
    ok: false,
    status,
    body: errorBody(lastErr),
    provider: lastProvider,
    failovers,
  };
}

/** Read upstream until the first complete SSE data event. */
async function readFirstEvent(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  parser: SseParser,
  signal: AbortSignal,
): Promise<FirstEvent> {
  while (true) {
    const { done, value } = await reader.read();
    if (signal.aborted) {
      throw new ProviderRequestError(499, "Request aborted", "aborted");
    }
    if (done) {
      const leftover = parser.flush();
      if (leftover.length) return classifyPayload(leftover[0]);
      return { type: "end" };
    }
    for (const payload of parser.feed(value)) {
      const ev = classifyPayload(payload);
      if (ev.type !== "chunk" || ev.payload !== "") return ev;
    }
  }
}

function classifyPayload(payload: string): FirstEvent {
  if (payload === "[DONE]") return { type: "end" };
  try {
    const json = JSON.parse(payload) as ChatCompletionChunk & {
      error?: { message?: string; type?: string; code?: string | number | null };
    };
    if (json.error) {
      return {
        type: "error",
        error: new ProviderRequestError(
          502,
          json.error.message ?? "Upstream stream error",
          json.error.type ?? "upstream_error",
          json.error.code ?? null,
        ),
      };
    }
    return { type: "chunk", payload };
  } catch {
    return { type: "chunk", payload };
  }
}

interface PipeParams {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  parser: SseParser;
  firstPayload: string;
  req: ChatCompletionRequest;
  providerId: string;
  servedModel: string;
  started: number;
  ttftMs: number;
  failovers: number;
  client: string | null;
}

/**
 * Continue pumping an already-committed upstream stream to the client,
 * rewriting the model name, accumulating usage, and logging on completion.
 */
function pipeStream(params: PipeParams): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const stats = { content: "", reasoning: "" };
  let usage: Usage | undefined;
  let cancelled = false;

  return new ReadableStream({
    async start(controller) {
      const send = (s: string) => {
        try {
          controller.enqueue(enc.encode(s));
        } catch {
          /* client gone */
        }
      };

      try {
        emitChunk(params.firstPayload, send, params.req.model);
        accumulate(stats, params.firstPayload);

        let done = false;
        while (true) {
          const { done: d, value } = await params.reader.read();
          if (d) break;
          for (const payload of params.parser.feed(value)) {
            if (payload === "[DONE]") {
              done = true;
              break;
            }
            try {
              const json = JSON.parse(payload) as ChatCompletionChunk & {
                error?: { message?: string };
              };
              if (json.error) {
                throw new ProviderRequestError(
                  502,
                  json.error.message ?? "Upstream stream error",
                  "upstream_error",
                );
              }
              if (json.usage) usage = json.usage;
            } catch {
              /* non-JSON passthrough line */
            }
            emitChunk(payload, send, params.req.model);
            accumulate(stats, payload);
          }
          if (done) break;
        }

        const completionTokens =
          usage?.completion_tokens ??
          estimateTokens(stats.content + stats.reasoning);
        send("data: [DONE]\n\n");
        try { controller.close(); } catch { /* ignore */ }

        logRequestSafe({
          requestedModel: params.req.model,
          servedModel: params.servedModel,
          provider: params.providerId,
          statusCode: 200,
          stream: true,
          promptTokens:
            usage?.prompt_tokens ?? estimatePromptTokens(params.req.messages),
          completionTokens,
          latencyMs: Date.now() - params.started,
          ttftMs: params.ttftMs,
          failovers: params.failovers,
          error: null,
          client: params.client,
        });
      } catch (e) {
        const err = toProviderError(e);
        if (!cancelled) {
          send(
            `data: ${JSON.stringify({
              error: {
                message: err.message,
                type: err.type,
                param: null,
                code: err.code,
              },
            })}\n\n`,
          );
          send("data: [DONE]\n\n");
        }
        try { controller.close(); } catch { /* ignore */ }

        logRequestSafe({
          requestedModel: params.req.model,
          servedModel: params.servedModel,
          provider: params.providerId,
          statusCode: cancelled ? 499 : err.status === 504 ? 504 : 502,
          stream: true,
          promptTokens: estimatePromptTokens(params.req.messages),
          completionTokens: estimateTokens(stats.content + stats.reasoning),
          latencyMs: Date.now() - params.started,
          ttftMs: params.ttftMs,
          failovers: params.failovers,
          error: cancelled ? "client disconnected" : err.message,
          client: params.client,
        });
      } finally {
        try { params.reader.releaseLock(); } catch { /* ignore */ }
      }
    },
    cancel() {
      cancelled = true;
      try { params.reader.cancel(); } catch { /* ignore */ }
      logRequestSafe({
        requestedModel: params.req.model,
        servedModel: params.servedModel,
        provider: params.providerId,
        statusCode: 499,
        stream: true,
        promptTokens: estimatePromptTokens(params.req.messages),
        completionTokens: estimateTokens(stats.content + stats.reasoning),
        latencyMs: Date.now() - params.started,
        ttftMs: params.ttftMs,
        failovers: params.failovers,
        error: "client disconnected",
        client: params.client,
      });
    },
  });
}

function accumulate(
  stats: { content: string; reasoning: string },
  payload: string,
): void {
  try {
    const json = JSON.parse(payload) as ChatCompletionChunk;
    const delta = json.choices?.[0]?.delta;
    if (!delta) return;
    if (typeof delta.content === "string" && delta.content) {
      stats.content += delta.content;
    }
    if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
      stats.reasoning += delta.reasoning_content;
    }
  } catch {
    /* ignore */
  }
}

/** Rewrite the model field to what the client asked for. */
function emitChunk(
  payload: string,
  send: (s: string) => void,
  requestedModel: string,
): void {
  try {
    const json = JSON.parse(payload) as ChatCompletionChunk;
    json.model = requestedModel;
    send(`data: ${JSON.stringify(json)}\n\n`);
  } catch {
    send(`data: ${payload}\n\n`);
  }
}

function reshapeCompletion(
  data: ChatCompletion,
  requestedModel: string,
): ChatCompletion {
  return {
    ...data,
    model: requestedModel,
    choices: data.choices?.map((c) => ({
      ...c,
      message: { ...c.message, content: c.message?.content ?? "" },
    })),
  };
}

function errorBody(e: ProviderRequestError | null): ApiErrorBody {
  return {
    error: {
      message:
        e?.message ??
        "All configured providers failed. No model could serve this request.",
      type: e?.type ?? "upstream_error",
      param: null,
      code: e?.code ?? null,
    },
  };
}

function abortedBody(): ApiErrorBody {
  return {
    error: {
      message: "Request aborted",
      type: "aborted",
      param: null,
      code: 499,
    },
  };
}

function emptyStream(params: {
  req: ChatCompletionRequest;
  providerId: string;
  servedModel: string;
  started: number;
  failovers: number;
  client: string | null;
}): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const id = `chatcmpl-${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  return new ReadableStream({
    start(controller) {
      const payload = {
        id,
        object: "chat.completion.chunk",
        created,
        model: params.req.model,
        choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: "stop" }],
      };
      controller.enqueue(enc.encode(`data: ${JSON.stringify(payload)}\n\n`));
      controller.enqueue(enc.encode("data: [DONE]\n\n"));
      controller.close();
      logRequestSafe({
        requestedModel: params.req.model,
        servedModel: params.servedModel,
        provider: params.providerId,
        statusCode: 200,
        stream: true,
        promptTokens: estimatePromptTokens(params.req.messages),
        completionTokens: 0,
        latencyMs: Date.now() - params.started,
        ttftMs: 0,
        failovers: params.failovers,
        error: null,
        client: params.client,
      });
    },
  });
}
