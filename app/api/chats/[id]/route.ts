import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, corsHeaders } from "@/lib/auth";
import { store } from "@/lib/db/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ownerFor(token: string): string {
  return createHash("sha256").update(`chat::${token}`).digest("hex").slice(0, 16);
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = requireAuth(req);
  if (!auth.ok) {
    return new NextResponse(auth.response.body, {
      status: auth.response.status,
      headers: { ...auth.response.headers, ...corsHeaders() },
    });
  }
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const { id } = await ctx.params;
  const chats = await store.chatsFor(ownerFor(bearer));
  const chat = chats.find((c) => c.id === id);
  if (!chat) {
    return NextResponse.json(
      { error: { message: "Chat not found.", type: "invalid_request_error", param: null, code: "chat_not_found" } },
      { status: 404, headers: corsHeaders() },
    );
  }
  return NextResponse.json(
    {
      id: chat.id,
      title: chat.title,
      createdAt: chat.createdAt.toISOString(),
      updatedAt: chat.updatedAt.toISOString(),
      messages: chat.messages,
    },
    { status: 200, headers: corsHeaders() },
  );
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = requireAuth(req);
  if (!auth.ok) {
    return new NextResponse(auth.response.body, {
      status: auth.response.status,
      headers: { ...auth.response.headers, ...corsHeaders() },
    });
  }
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const { id } = await ctx.params;
  const deleted = await store.deleteChat(ownerFor(bearer), id);
  return new NextResponse(null, {
    status: deleted ? 204 : 404,
    headers: corsHeaders(),
  });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}
