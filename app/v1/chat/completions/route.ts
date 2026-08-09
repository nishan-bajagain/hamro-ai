import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, corsHeaders, detectClient } from "@/lib/auth";
import {
  openStream,
  routeNonStream,
  isRandomSelector,
} from "@/lib/ai/router";
import { canonicalModelId } from "@/lib/config";
import { checkRateLimit } from "@/lib/rate-limit";
import { cacheGet, cacheSet } from "@/lib/cache";
import { logRequestSafe } from "@/lib/db/log";
import { estimatePromptTokens, estimateTokens } from "@/lib/ai/tokens";
import type { ApiErrorBody, ChatCompletion, ChatCompletionRequest } from "@/lib/ai/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Map a router error result to the documented HTTP contract (README/DOCS):
 * 404 unknown model, 429 upstream rate limit / client rate limit, 499 client
 * disconnect — anything else (all providers failed) becomes 502.
 */
function gatewayErrorStatus(status: number): number {
  return status === 404 || status === 429 || status === 499 ? status : 502;
}

/** Error responses keep the same X-Gateway-* diagnostics as success ones. */
function gatewayErrorHeaders(result: {
  provider?: string;
  failovers: number;
}): Record<string, string> {
  return {
    ...(result.provider ? { "X-Gateway-Provider": result.provider } : {}),
    "X-Gateway-Failovers": String(result.failovers ?? 0),
    ...corsHeaders(),
  };
}

function errorBody(message: string, code: string | number | null = null): ApiErrorBody {
  return {
    error: {
      message,
      type: "invalid_request_error",
      param: null,
      code,
    },
  };
}

function validate(body: Partial<ChatCompletionRequest>): ApiErrorBody | null {
  if (typeof body.model !== "string" || !body.model.trim()) {
    return errorBody("You must provide a `model` parameter.");
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return errorBody("`messages` must be a non-empty array.");
  }
  for (const m of body.messages) {
    if (!m || typeof m !== "object" || typeof (m as { role?: unknown }).role !== "string") {
      return errorBody("Each message must have a `role`.");
    }
    const role = (m as { role: string }).role;
    if (!["system", "user", "assistant", "tool", "developer"].includes(role)) {
      return errorBody(`Unsupported message role: '${role}'.`);
    }
  }
  return null;
}

/** Deterministic requests (temperature=0, no tools, non-stream) are cacheable. */
function isCacheable(body: ChatCompletionRequest): boolean {
  return !body.stream && body.temperature === 0 && !body.tools && !body.tool_choice;
}

function cacheKeyFor(body: ChatCompletionRequest): string {
  return JSON.stringify({
    model: body.model,
    messages: body.messages,
    temperature: body.temperature,
    max_tokens: body.max_tokens ?? null,
    top_p: body.top_p ?? null,
    stop: body.stop ?? null,
    response_format: body.response_format ?? null,
    presence_penalty: body.presence_penalty ?? null,
    frequency_penalty: body.frequency_penalty ?? null,
  });
}

function rateLimitHeaders(rl: {
  remaining: number;
  limit: number;
}): Record<string, string> {
  if (rl.limit === 0) return {};
  return {
    "X-RateLimit-Limit": String(rl.limit),
    "X-RateLimit-Remaining": String(rl.remaining),
  };
}

/**
 * Derive a stable per-client session key for the sticky random model.
 *
 * Precedence: an explicit `x-session-id` header, then the request `user`
 * field, then a fingerprint of (client, user-agent, IP). The bearer key is
 * always mixed in so different users never share a pin. Hashing keeps raw
 * identifiers out of memory.
 */
function sessionKeyFor(
  req: NextRequest,
  bearer: string,
  body: Partial<ChatCompletionRequest>,
): string {
  const explicit = req.headers.get("x-session-id")?.trim();
  const userField =
    typeof body.user === "string" && body.user.trim() ? body.user.trim() : "";
  const idPart =
    explicit ||
    userField ||
    [
      detectClient(req),
      req.headers.get("user-agent") ?? "",
      req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "",
    ].join("|");
  return createHash("sha256")
    .update(`${bearer}::${idPart}`)
    .digest("hex")
    .slice(0, 32);
}

/**
 * Top-level guard: no exception from the handler may ever surface as a raw
 * 500/HTML error — every failure path returns OpenAI-style error JSON.
 */
export async function POST(req: NextRequest) {
  try {
    return await handlePost(req);
  } catch (e) {
    console.error("Unhandled error in POST /v1/chat/completions:", e);
    if (req.signal.aborted) {
      return NextResponse.json(
        {
          error: {
            message: "Request aborted",
            type: "aborted",
            param: null,
            code: 499,
          },
        },
        { status: 499, headers: corsHeaders() },
      );
    }
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json(
      {
        error: {
          message: `Internal server error: ${message}`,
          type: "server_error",
          param: null,
          code: "internal_error",
        },
      },
      { status: 500, headers: corsHeaders() },
    );
  }
}

async function handlePost(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) {
    return new NextResponse(auth.response.body, {
      status: auth.response.status,
      headers: { ...auth.response.headers, ...corsHeaders() },
    });
  }

  // ── Rate limiting (sliding window, per API key) ──
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "unknown";
  const rl = checkRateLimit(bearer);
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error: {
          message: `Rate limit exceeded. Try again in ${rl.retryAfterSeconds}s.`,
          type: "rate_limit_error",
          param: null,
          code: "rate_limit_exceeded",
        },
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(rl.retryAfterSeconds),
          ...corsHeaders(),
        },
      },
    );
  }

  let body: ChatCompletionRequest;
  try {
    body = (await req.json()) as ChatCompletionRequest;
  } catch {
    return NextResponse.json(errorBody("Invalid JSON in request body."), {
      status: 400,
      headers: corsHeaders(),
    });
  }

  const invalid = validate(body);
  if (invalid) {
    return NextResponse.json(invalid, { status: 400, headers: corsHeaders() });
  }

  const client = detectClient(req);
  const sessionKey = sessionKeyFor(req, bearer, body);
  const randomRequested = isRandomSelector(body.model);

  // ── Streaming: failover happens before the first chunk is emitted ──
  if (body.stream) {
    const result = await openStream(body, {
      signal: req.signal,
      client,
      sessionKey,
    });
    if (!result.ok) {
      return NextResponse.json(result.body, {
        status: gatewayErrorStatus(result.status),
        headers: gatewayErrorHeaders(result),
      });
    }
    const response = new Response(result.start.stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        "X-Gateway-Provider": result.start.provider,
        "X-Gateway-Model": result.start.servedModel,
        "X-Gateway-Failovers": String(result.start.failovers),
        ...(randomRequested
          ? {
              "X-Gateway-Session-Model": canonicalModelId(
                result.start.provider as Parameters<typeof canonicalModelId>[0],
                result.start.servedModel,
              ),
            }
          : {}),
        ...rateLimitHeaders(rl),
        ...corsHeaders(),
      },
    });
    return response;
  }

  // ── Non-streaming: deterministic responses can be served from cache ──
  if (isCacheable(body)) {
    const cacheKey = cacheKeyFor(body);
    const cached = cacheGet<ChatCompletion>(cacheKey);
    if (cached) {
      const promptTokens = cached.usage?.prompt_tokens ?? estimatePromptTokens(body.messages);
      const completionTokens =
        cached.usage?.completion_tokens ??
        estimateTokens(cached.choices[0]?.message?.content ?? "");
      logRequestSafe({
        requestedModel: body.model,
        servedModel: body.model,
        provider: "cache",
        statusCode: 200,
        stream: false,
        promptTokens,
        completionTokens,
        latencyMs: 0,
        ttftMs: 0,
        failovers: 0,
        error: null,
        client,
        cached: true,
      });
      return NextResponse.json(cached, {
        status: 200,
        headers: {
          "X-Gateway-Provider": "cache",
          "X-Gateway-Model": body.model,
          "X-Gateway-Failovers": "0",
          "X-Gateway-Cache": "HIT",
          ...rateLimitHeaders(rl),
          ...corsHeaders(),
        },
      });
    }

    const result = await routeNonStream(body, {
      signal: req.signal,
      client,
      sessionKey,
    });
    if (!result.ok) {
      return NextResponse.json(result.body, {
        status: gatewayErrorStatus(result.status),
        headers: gatewayErrorHeaders(result),
      });
    }
    cacheSet(cacheKey, result.completion);
    return NextResponse.json(result.completion, {
      status: 200,
      headers: {
        "X-Gateway-Provider": result.provider,
        "X-Gateway-Model": result.servedModel,
        "X-Gateway-Failovers": String(result.failovers),
        "X-Gateway-Cache": "MISS",
        ...(randomRequested
          ? {
              "X-Gateway-Session-Model": canonicalModelId(
                result.provider as Parameters<typeof canonicalModelId>[0],
                result.servedModel,
              ),
            }
          : {}),
        ...rateLimitHeaders(rl),
        ...corsHeaders(),
      },
    });
  }

  // ── Non-streaming: full failover across the chain ──
  const result = await routeNonStream(body, {
    signal: req.signal,
    client,
    sessionKey,
  });
  if (!result.ok) {
    return NextResponse.json(result.body, {
      status: gatewayErrorStatus(result.status),
      headers: gatewayErrorHeaders(result),
    });
  }
  return NextResponse.json(result.completion, {
    status: 200,
    headers: {
      "X-Gateway-Provider": result.provider,
      "X-Gateway-Model": result.servedModel,
      "X-Gateway-Failovers": String(result.failovers),
      ...(randomRequested
        ? {
            "X-Gateway-Session-Model": canonicalModelId(
              result.provider as Parameters<typeof canonicalModelId>[0],
              result.servedModel,
            ),
          }
        : {}),
      ...rateLimitHeaders(rl),
      ...corsHeaders(),
    },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}
