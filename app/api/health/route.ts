import { NextResponse } from "next/server";
import { store } from "@/lib/db/store";
import { getConfiguredProviders } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STARTED_AT = Date.now();

/**
 * Lightweight liveness/health probe for uptime monitors (UptimeRobot, Pingdom,
 * Vercel Cron, etc.). Unauthenticated by design: it only exposes coarse health,
 * never keys or full telemetry.
 */
export async function GET() {
  const [requests, providerStatusList] = await Promise.all([
    store.requests(),
    store.providerStatuses(),
  ]);

  const providerMap = new Map(providerStatusList.map((s) => [s.provider, s]));
  const providers = getConfiguredProviders().map((p) => {
    const st = providerMap.get(p.id);
    return {
      id: p.id,
      status: st?.status ?? "unknown",
      latencyMs: st?.latencyMs ?? null,
      lastCheck: st?.lastCheck ?? null,
    };
  });

  const allOnline = providers.every((p) => p.status === "online");
  const status = allOnline ? "ok" : "degraded";

  return NextResponse.json(
    {
      status,
      service: "hamro-site-ai-gateway",
      uptimeSeconds: Math.floor((Date.now() - STARTED_AT) / 1000),
      totalRequests: requests.length,
      providers,
      ts: new Date().toISOString(),
    },
    {
      status: status === "ok" ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
