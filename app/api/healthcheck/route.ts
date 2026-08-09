import { NextResponse } from "next/server";
import { getConfiguredProviders, canonicalModelId } from "@/lib/config";
import { corsHeaders } from "@/lib/auth";
import { fetchChatCompletion, buildBody, parseErrorBody } from "@/lib/ai/providers";
import { setProviderStatus } from "@/lib/db/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 15_000;
let inFlight = false;

export async function POST() {
  if (inFlight) {
    return NextResponse.json(
      { running: true, message: "Health check already in progress" },
      { status: 409, headers: corsHeaders() },
    );
  }
  inFlight = true;
  try {
    const providers = getConfiguredProviders();
    const results = await Promise.all(
      providers.map(async (p) => {
        const model = p.models[0];
        const started = Date.now();
        try {
          const res = await fetchChatCompletion(
            p,
            buildBody(
              {
                model: canonicalModelId(p.id, model.id),
                messages: [{ role: "user", content: "ping" }],
                max_tokens: 1,
                temperature: 0,
                stream: false,
              },
              model.id,
              p,
            ),
            AbortSignal.timeout(TIMEOUT_MS),
          );
          const latencyMs = Date.now() - started;
          if (res.ok) {
            await setProviderStatus(p.id, "online", latencyMs, model.id);
            return {
              provider: p.id,
              status: "online",
              latencyMs,
              model: model.id,
            };
          }
          const err = await parseErrorBody(res);
          await setProviderStatus(p.id, "degraded", latencyMs, model.id, err.message);
          return {
            provider: p.id,
            status: "degraded",
            latencyMs,
            model: model.id,
            error: err.message,
          };
        } catch (e) {
          const latencyMs = Date.now() - started;
          const message = e instanceof Error ? e.message : String(e);
          await setProviderStatus(p.id, "offline", latencyMs, model.id, message);
          return {
            provider: p.id,
            status: "offline",
            latencyMs,
            model: model.id,
            error: message,
          };
        }
      }),
    );
    return NextResponse.json(
      { checkedAt: new Date().toISOString(), results },
      { headers: corsHeaders() },
    );
  } finally {
    inFlight = false;
  }
}
