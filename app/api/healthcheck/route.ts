import { NextResponse } from "next/server";
import { getConfiguredProviders, canonicalModelId } from "@/lib/config";
import { corsHeaders } from "@/lib/auth";
import { fetchChatCompletion, buildBody, parseErrorBody } from "@/lib/ai/providers";
import { setProviderStatus } from "@/lib/db/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 25_000;
/** How many models to try per provider before calling it down. Free tiers
 *  rate-limit individual models, so a provider whose FIRST model is
 *  exhausted should still report "online" when another model answers. */
const MAX_PROBE_MODELS = 3;
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
        // Try several models (not just the first) — a rate-limited or
        // quota-blocked model must not mislabel a provider that still works.
        const candidates = p.models.slice(0, MAX_PROBE_MODELS);
        if (candidates.length === 0) {
          await setProviderStatus(p.id, "degraded", null, "", "no models configured");
          return {
            provider: p.id,
            status: "degraded",
            latencyMs: null,
            model: "",
            error: "no models configured",
          };
        }
        let lastError: string | null = null;
        let lastModel: string = candidates[0].id;
        for (const model of candidates) {
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
            lastError = err.message;
            lastModel = model.id;
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            lastError = message;
            lastModel = model.id;
          }
        }
        const latencyMs = null; // no successful probe to measure
        await setProviderStatus(p.id, "degraded", latencyMs, lastModel, lastError ?? undefined);
        return {
          provider: p.id,
          status: "degraded",
          latencyMs,
          model: lastModel,
          error: lastError,
        };
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
