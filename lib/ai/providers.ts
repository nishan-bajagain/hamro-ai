import type { ProviderConfig } from "@/lib/config";
import { SITE_NAME } from "@/lib/config";
import type { ChatCompletionRequest } from "@/lib/ai/types";
import { SseParser } from "@/lib/ai/sse";

export { SseParser };

/**
 * Low-level provider client: builds headers, performs the upstream HTTP call
 * and parses OpenAI-compatible error bodies.
 */

export class ProviderRequestError extends Error {
  status: number;
  type: string;
  code: string | number | null;
  retryAfter?: number;

  constructor(
    status: number,
    message: string,
    type = "upstream_error",
    code: string | number | null = null,
    retryAfter?: number,
  ) {
    super(message);
    this.name = "ProviderRequestError";
    this.status = status;
    this.type = type;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

/** HTTP statuses that justify trying the next provider in the chain. */
export function shouldFailover(status: number): boolean {
  // 400 is a malformed request — retrying another provider won't help.
  // 402 (payment required) is included: several free-tier providers return
  // it when the account has no balance, and the next provider should take over.
  return (
    status === 401 ||
    status === 402 ||
    status === 403 ||
    status === 404 ||
    status === 429 ||
    status >= 500
  );
}

/**
 * Providers known to accept `stream_options.include_usage` on streaming
 * requests. The more exotic OpenAI-compatible APIs (Ollama, HuggingFace,
 * Chutes, OpenCode) may reject unknown fields, so they are excluded and fall
 * back to character-based token estimation instead.
 */
const SUPPORTS_INCLUDE_USAGE = new Set([
  "groq",
  "openrouter",
  "naga",
  "zenmux",
  "llm7",
  "cerebras",
  // OpenAI-compatible providers verified to return real `usage` in the final
  // SSE chunk — mistral and z.ai both accept stream_options.include_usage.
  "mistral",
  "zai",
]);

/** Whether the provider accepts the `stream_options` body field. */
export function supportsIncludeUsage(providerId: string): boolean {
  return SUPPORTS_INCLUDE_USAGE.has(providerId);
}

export function buildHeaders(provider: ProviderConfig): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${provider.apiKey}`,
  };
  if (provider.id === "openrouter") {
    headers["HTTP-Referer"] = `https://${SITE_NAME}`;
    headers["X-Title"] = `${SITE_NAME} AI Gateway`;
  }
  return headers;
}

/** OpenAI-compatible body for the upstream call. */
export function buildBody(
  req: ChatCompletionRequest,
  model: string,
  provider: ProviderConfig,
): Record<string, unknown> {
  const body: Record<string, unknown> = { ...req, model };
  if (req.stream) {
    // Only providers known to support `stream_options.include_usage` get it;
    // for others we fall back to character-based token estimation.
    if (supportsIncludeUsage(provider.id)) {
      body.stream_options = {
        include_usage: true,
        ...(req.stream_options ?? {}),
      };
    } else if (req.stream_options) {
      body.stream_options = req.stream_options;
    }
  }
  return body;
}

export async function fetchChatCompletion(
  provider: ProviderConfig,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<Response> {
  return fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: buildHeaders(provider),
    body: JSON.stringify(body),
    signal,
    // Providers must see the full body for token accounting.
    cache: "no-store",
  });
}

/** Parse an OpenAI-style error body from a non-2xx upstream response. */
export async function parseErrorBody(res: Response): Promise<ProviderRequestError> {
  let message = `Provider returned HTTP ${res.status}`;
  let type = "upstream_error";
  let code: string | number | null = null;
  try {
    const data = await res.json();
    if (data?.error) {
      message = data.error.message ?? message;
      type = data.error.type ?? type;
      code = data.error.code ?? code;
    } else if (typeof data?.message === "string") {
      message = data.message;
    }
  } catch {
    // non-JSON error body — keep defaults
  }
  const retryAfter = Number(res.headers.get("retry-after")) || undefined;
  return new ProviderRequestError(res.status, message, type, code, retryAfter);
}

/** Convert any thrown value into a ProviderRequestError. */
export function toProviderError(e: unknown): ProviderRequestError {
  if (e instanceof ProviderRequestError) return e;
  const err = e as { name?: string; message?: string };
  if (err?.name === "TimeoutError") {
    return new ProviderRequestError(
      504,
      `Upstream request timed out: ${err.message ?? ""}`.trim(),
      "upstream_timeout",
    );
  }
  if (err?.name === "AbortError") {
    return new ProviderRequestError(499, "Request aborted", "aborted");
  }
  if (err instanceof TypeError) {
    return new ProviderRequestError(
      502,
      `Network error talking to provider: ${err.message}`,
      "connection_error",
    );
  }
  return new ProviderRequestError(
    502,
    err?.message ?? "Unknown upstream error",
    "upstream_error",
  );
}

/* ─────────────────────────── SSE parsing ──────────────────────────── */

// SseParser lives in its own dependency-free module (lib/ai/sse.ts) so it can
// be unit-tested directly; re-exported here for existing importers.

