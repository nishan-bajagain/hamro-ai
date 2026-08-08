import { NextRequest, NextResponse } from "next/server";
import { requireAuth, corsHeaders, detectClient } from "@/lib/auth";
import { openStream, routeNonStream } from "@/lib/ai/router";
import { checkRateLimit } from "@/lib/rate-limit";
import { cacheGet, cacheSet } from "@/lib/cache";
import { logRequestSafe } from "@/lib/db/log";
import { estimatePromptTokens, estimateTokens } from "@/lib/ai/tokens";
import type { ApiErrorBody, ChatCompletion, ChatCompletionRequest } from "@/lib/ai/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function POST(req: NextRequest) {
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

  // ── Streaming: failover happens before the first chunk is emitted ──
  if (body.stream) {
    const result = await openStream(body, { signal: req.signal, client });
    if (!result.ok) {
      const status = result.status === 429 ? 429 : 502;
      return NextResponse.json(result.body, { status, headers: corsHeaders() });
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

    const result = await routeNonStream(body, { signal: req.signal, client });
    if (!result.ok) {
      const status = result.status === 429 ? 429 : 502;
      return NextResponse.json(result.body, { status, headers: corsHeaders() });
    }
    cacheSet(cacheKey, result.completion);
    return NextResponse.json(result.completion, {
      status: 200,
      headers: {
        "X-Gateway-Provider": result.provider,
        "X-Gateway-Model": result.servedModel,
        "X-Gateway-Failovers": String(result.failovers),
        "X-Gateway-Cache": "MISS",
        ...rateLimitHeaders(rl),
        ...corsHeaders(),
      },
    });
  }

  // ── Non-streaming: full failover across the chain ──
  const result = await routeNonStream(body, { signal: req.signal, client });
  if (!result.ok) {
    const status = result.status === 429 ? 429 : 502;
    return NextResponse.json(result.body, { status, headers: corsHeaders() });
  }
  return NextResponse.json(result.completion, {
    status: 200,
    headers: {
      "X-Gateway-Provider": result.provider,
      "X-Gateway-Model": result.servedModel,
      "X-Gateway-Failovers": String(result.failovers),
      ...rateLimitHeaders(rl),
      ...corsHeaders(),
    },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}
