import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { corsHeaders, detectClient, verifyApiKey } from "@/lib/auth";
import {
  openStream,
  routeNonStream,
  isRandomSelector,
} from "@/lib/ai/router";
import { canonicalModelId } from "@/lib/config";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  buildOpenAIRequest,
  createAnthropicStream,
  openaiToAnthropicMessage,
  type AnthropicRequest,
} from "@/lib/anthropic";
import type { ApiErrorBody } from "@/lib/ai/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Anthropic Messages API (`POST /v1/messages`) — lets Claude Code and other
 * Anthropic-protocol clients use this gateway directly, no proxy needed.
 *
 * Auth accepts the Anthropic `x-api-key` header as well as the usual
 * `Authorization: Bearer` (Claude Code sends `x-api-key` when
 * `ANTHROPIC_AUTH_TOKEN` is set). Requests are translated to the internal
 * OpenAI shape and routed through the same smart router (failover, `random`
 * session pinning, telemetry); responses / streams are translated back.
 */

/** Extract the gateway key from either Anthropic or Bearer auth. */
function apiKeyFrom(req: NextRequest): string {
  const x = req.headers.get("x-api-key")?.trim();
  if (x) return x;
  const auth = req.headers.get("authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
}

/** Anthropic error body: {type:"error", error:{type, message}}. */
function anthropicErrorResponse(
  status: number,
  errorType: string,
  message: string,
  headers: Record<string, string> = {},
): NextResponse {
  return NextResponse.json(
    { type: "error", error: { type: errorType, message } },
    { status, headers: { ...headers, ...corsHeaders() } },
  );
}

/** Map the gateway's documented HTTP statuses to Anthropic error types. */
function anthropicErrorType(status: number): string {
  switch (status) {
    case 401:
      return "authentication_error";
    case 404:
      return "not_found_error";
    case 429:
      return "rate_limit_error";
    case 400:
      return "invalid_request_error";
    default:
      return "api_error";
  }
}

function gatewayErrorHeaders(result: {
  provider?: string;
  failovers: number;
}): Record<string, string> {
  return {
    ...(result.provider ? { "X-Gateway-Provider": result.provider } : {}),
    "X-Gateway-Failovers": String(result.failovers ?? 0),
  };
}

/**
 * Derive a stable per-client session key for the sticky random model —
 * mirrors app/v1/chat/completions/route.ts.
 */
function sessionKeyFor(req: NextRequest, token: string): string {
  // x-session-id (generic clients), then Claude Code's own stable session id.
  const explicit =
    req.headers.get("x-session-id")?.trim() ||
    req.headers.get("x-claude-code-session-id")?.trim();
  const idPart =
    explicit ||
    [
      detectClient(req),
      req.headers.get("user-agent") ?? "",
      req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "",
    ].join("|");
  return createHash("sha256")
    .update(`${token}::${idPart}`)
    .digest("hex")
    .slice(0, 32);
}

function validate(body: Partial<AnthropicRequest>): string | null {
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return "`messages` must be a non-empty array.";
  }
  for (const m of body.messages) {
    // Claude Code can send a `system` role message inside `messages` in
    // addition to the top-level `system` field.
    if (!m || (m.role !== "user" && m.role !== "assistant" && m.role !== "system")) {
      return "Each message must have `role` of \"user\", \"assistant\" or \"system\".";
    }
    if (typeof m.content !== "string" && !Array.isArray(m.content)) {
      return "Each message must have a `content` string or block array.";
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    return await handlePost(req);
  } catch (e) {
    console.error("Unhandled error in POST /v1/messages:", e);
    if (req.signal.aborted) {
      return anthropicErrorResponse(499, "api_error", "Request aborted");
    }
    return anthropicErrorResponse(
      500,
      "api_error",
      `Internal server error: ${e instanceof Error ? e.message : "unknown error"}`,
    );
  }
}

async function handlePost(req: NextRequest) {
  const token = apiKeyFrom(req);
  if (!token || !verifyApiKey(token)) {
    return anthropicErrorResponse(
      401,
      "authentication_error",
      "Invalid API key. Provide `x-api-key: <key>` (or `Authorization: Bearer <key>`). Contact the operator of this gateway for an access key.",
    );
  }

  const rl = checkRateLimit(token);
  if (!rl.allowed) {
    return anthropicErrorResponse(
      429,
      "rate_limit_error",
      `Rate limit exceeded. Try again in ${rl.retryAfterSeconds}s.`,
      { "Retry-After": String(rl.retryAfterSeconds) },
    );
  }

  let body: AnthropicRequest;
  try {
    body = (await req.json()) as AnthropicRequest;
  } catch {
    return anthropicErrorResponse(
      400,
      "invalid_request_error",
      "Invalid JSON in request body.",
    );
  }

  const invalid = validate(body);
  if (invalid) {
    return anthropicErrorResponse(400, "invalid_request_error", invalid);
  }

  const openAIReq = buildOpenAIRequest(body);
  const requestedModel = openAIReq.model;
  const randomRequested = isRandomSelector(requestedModel);
  const client = detectClient(req);
  const sessionKey = sessionKeyFor(req, token);

  if (body.stream) {
    const result = await openStream(openAIReq, {
      signal: req.signal,
      client,
      sessionKey,
    });
    if (!result.ok) {
      return anthropicErrorResponse(
        result.status === 499 ? 499 : result.status,
        anthropicErrorType(result.status),
        (result.body as ApiErrorBody).error?.message ?? "All providers failed.",
        gatewayErrorHeaders(result),
      );
    }
    const stream = createAnthropicStream(
      result.start.stream,
      requestedModel,
      result.start.promptTokens,
    );
    return new Response(stream, {
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
        ...corsHeaders(),
      },
    });
  }

  const result = await routeNonStream(openAIReq, {
    signal: req.signal,
    client,
    sessionKey,
  });
  if (!result.ok) {
    return anthropicErrorResponse(
      result.status === 499 ? 499 : result.status,
      anthropicErrorType(result.status),
      (result.body as ApiErrorBody).error?.message ?? "All providers failed.",
      gatewayErrorHeaders(result),
    );
  }
  const anthropic = openaiToAnthropicMessage(result.completion, requestedModel, {
    inputTokens: result.promptTokens,
    outputTokens: result.completionTokens,
  });
  return NextResponse.json(anthropic, {
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
      ...corsHeaders(),
    },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}
