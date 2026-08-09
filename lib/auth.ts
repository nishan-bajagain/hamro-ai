import { NextResponse } from "next/server";
import { PUBLIC_API_KEY } from "@/lib/config";

/**
 * Validates `Authorization: Bearer <PUBLIC_API_KEY>` for every /v1/* call.
 * Uses a timing-safe comparison to avoid leaking key length via timing.
 */
export function requireAuth(
  request: Request,
): { ok: true } | { ok: false; response: NextResponse } {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ")
    ? header.slice("Bearer ".length).trim()
    : "";

  if (!token || !timingSafeEqual(token, PUBLIC_API_KEY)) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: {
            message:
              "Invalid API key. Provide a valid `Authorization: Bearer <key>` header. Contact the operator of this gateway for an access key.",
            type: "invalid_request_error",
            param: null,
            code: "invalid_api_key",
          },
        },
        { status: 401 },
      ),
    };
  }
  return { ok: true };
}

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const bufA = enc.encode(a);
  const bufB = enc.encode(b);
  // No early return on length mismatch: a length check short-circuits before
  // the byte comparison and leaks whether the attacker's guess had the right
  // length via timing. Instead the length difference is folded into `diff`, so
  // every comparison runs the full fixed-iteration loop regardless of input.
  const max = Math.max(32, bufA.length, bufB.length);
  let diff = bufA.length ^ bufB.length;
  for (let i = 0; i < max; i++) {
    diff |= (bufA[i % bufA.length] ?? 0) ^ (bufB[i % bufB.length] ?? 0);
  }
  return diff === 0;
}

/** Identify which coding agent / client is calling (best effort). */
export function detectClient(request: Request): string {
  const explicit = request.headers.get("x-client");
  if (explicit) return explicit.slice(0, 64);
  // Lowercase before matching so casing differences (e.g. "Claude",
  // "CURSOR", "OpenCode") never make a real client go undetected.
  const ua = (request.headers.get("user-agent") ?? "").toLowerCase();
  if (ua.includes("claude")) return "claude-code";
  if (ua.includes("cursor")) return "cursor";
  if (ua.includes("aider")) return "aider";
  if (ua.includes("opencode")) return "opencode";
  if (ua.includes("curl")) return "curl";
  if (ua.includes("python")) return "python";
  return ua.slice(0, 48) || "unknown";
}

export function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}
