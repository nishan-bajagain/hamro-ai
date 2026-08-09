import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, corsHeaders } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { store, MAX_CHATS_PER_KEY } from "@/lib/db/store";
import type { ChatDoc } from "@/lib/db/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Chat-history database — `data.json` (same store as telemetry), not any
 * online JSON-blob service. Every endpoint requires the gateway key and is
 * namespaced per key (hashed), so one user can never read another's chats.
 *
 *   GET    /api/chats          → chat summaries (no message bodies)
 *   POST   /api/chats          → create/update chats ({id?,title,messages} or {chats:[…]})
 *   DELETE /api/chats          → delete every chat for this key
 */

function ownerFor(token: string): string {
  return createHash("sha256").update(`chat::${token}`).digest("hex").slice(0, 16);
}

function apiError(message: string, status: number, code: string | null = null): NextResponse {
  return NextResponse.json(
    { error: { message, type: "invalid_request_error", param: null, code } },
    { status, headers: corsHeaders() },
  );
}

function chatSummary(doc: ChatDoc) {
  return {
    id: doc.id,
    title: doc.title,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    messageCount: doc.messages.length,
  };
}

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) {
    return new NextResponse(auth.response.body, {
      status: auth.response.status,
      headers: { ...auth.response.headers, ...corsHeaders() },
    });
  }
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const chats = await store.chatsFor(ownerFor(bearer));
  // ?full=1 returns full chat bodies (the web client needs them to render);
  // the default stays light (summaries only) for dashboards and low-bandwidth
  // callers.
  const full = new URL(req.url).searchParams.get("full") === "1";
  return NextResponse.json(
    {
      chats: chats.map((c) =>
        full ? { ...chatSummary(c), messages: c.messages } : chatSummary(c),
      ),
    },
    { status: 200, headers: corsHeaders() },
  );
}

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) {
    return new NextResponse(auth.response.body, {
      status: auth.response.status,
      headers: { ...auth.response.headers, ...corsHeaders() },
    });
  }
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const rl = checkRateLimit(bearer);
  if (!rl.allowed) {
    return apiError(`Rate limit exceeded. Try again in ${rl.retryAfterSeconds}s.`, 429, "rate_limit_exceeded");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError("Invalid JSON in request body.", 400);
  }

  // Accept either a single chat or a bulk { chats: [...] } payload.
  const items: unknown[] =
    Array.isArray(body) && body.length
      ? body
      : Array.isArray((body as { chats?: unknown })?.chats)
        ? ((body as { chats: unknown[] }).chats)
        : [body];

  if (items.length > MAX_CHATS_PER_KEY) {
    return apiError(`Can only save up to ${MAX_CHATS_PER_KEY} chats per request.`, 400);
  }

  const owner = ownerFor(bearer);
  const saved: ChatDoc[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") {
      return apiError("Each chat must be an object with `title` and `messages`.", 400);
    }
    const result = await store.upsertChat(owner, item as { id?: string; title?: unknown; messages?: unknown });
    if (!result.ok) return apiError(result.error, 400);
    saved.push(result.doc);
  }
  return NextResponse.json(
    { chats: saved.map(chatSummary) },
    { status: 200, headers: corsHeaders() },
  );
}

export async function DELETE(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) {
    return new NextResponse(auth.response.body, {
      status: auth.response.status,
      headers: { ...auth.response.headers, ...corsHeaders() },
    });
  }
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  await store.clearChats(ownerFor(bearer));
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}
