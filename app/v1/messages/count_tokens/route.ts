import { NextRequest, NextResponse } from "next/server";
import { corsHeaders, verifyApiKey } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { estimatePromptTokens, estimateTokens } from "@/lib/ai/tokens";
import { buildOpenAIRequest, type AnthropicRequest } from "@/lib/anthropic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /v1/messages/count_tokens` — Claude Code calls this to count tokens
 * for context compaction. The gateway has no upstream tokenizer, so this
 * returns the same char-based estimate used everywhere else in telemetry;
 * accuracy is close enough for the client's budgeting.
 */
export async function POST(req: NextRequest) {
  const x = req.headers.get("x-api-key")?.trim();
  const auth = req.headers.get("authorization") ?? "";
  const token =
    x ??
    (auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "");

  if (!token || !verifyApiKey(token)) {
    return NextResponse.json(
      {
        type: "error",
        error: { type: "authentication_error", message: "Invalid API key." },
      },
      { status: 401, headers: corsHeaders() },
    );
  }

  const rl = checkRateLimit(token);
  if (!rl.allowed) {
    return NextResponse.json(
      {
        type: "error",
        error: {
          type: "rate_limit_error",
          message: `Rate limit exceeded. Try again in ${rl.retryAfterSeconds}s.`,
        },
      },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfterSeconds), ...corsHeaders() },
      },
    );
  }

  let body: AnthropicRequest;
  try {
    body = (await req.json()) as AnthropicRequest;
  } catch {
    return NextResponse.json(
      {
        type: "error",
        error: { type: "invalid_request_error", message: "Invalid JSON in request body." },
      },
      { status: 400, headers: corsHeaders() },
    );
  }

  const openAIReq = buildOpenAIRequest(body);
  let inputTokens = estimatePromptTokens(openAIReq.messages);
  if (body.tools?.length) {
    inputTokens += estimateTokens(JSON.stringify(body.tools));
  }
  return NextResponse.json(
    { input_tokens: inputTokens },
    { status: 200, headers: corsHeaders() },
  );
}
