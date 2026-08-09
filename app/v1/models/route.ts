import { NextRequest, NextResponse } from "next/server";
import { requireAuth, corsHeaders } from "@/lib/auth";
import { getConfiguredProviders, canonicalModelId } from "@/lib/config";
import { pricingFor } from "@/lib/ai/pricing";
import { checkRateLimit } from "@/lib/rate-limit";
import type { ModelListResponse } from "@/lib/ai/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stable-ish creation timestamps so agents that sort by `created` behave. */
const CREATED_EPOCH = 1_735_689_600; // 2025-01-01T00:00:00Z

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) {
    return new NextResponse(auth.response.body, {
      status: auth.response.status,
      headers: { ...auth.response.headers, ...corsHeaders() },
    });
  }

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
        headers: { "Retry-After": String(rl.retryAfterSeconds), ...corsHeaders() },
      },
    );
  }

  const maxContext = Math.max(
    0,
    ...getConfiguredProviders().flatMap((p) => p.models.map((m) => m.context)),
  );

  // Virtual "random" model: the router picks a random configured model and
  // pins it per session until the user disconnects or the model errors.
  const randomModel: ModelListResponse["data"][number] = {
    id: "random",
    object: "model",
    created: CREATED_EPOCH,
    owned_by: "hamro",
    context_length: maxContext || 131072,
    pricing: { input: "0", output: "0" },
  };

  const data: ModelListResponse["data"] = getConfiguredProviders().flatMap(
    (p) =>
      p.models.map((m) => {
        const pricing = pricingFor(p.id, m.id);
        return {
          id: canonicalModelId(p.id, m.id),
          object: "model",
          created: CREATED_EPOCH,
          owned_by: p.id,
          context_length: m.context,
          pricing: {
            input: pricing.input === 0 ? "0" : pricing.input.toFixed(4),
            output: pricing.output === 0 ? "0" : pricing.output.toFixed(4),
          },
        };
      }),
  );

  data.unshift(randomModel);

  return NextResponse.json(
    { object: "list", data } satisfies ModelListResponse,
    { status: 200, headers: corsHeaders() },
  );
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}
