import { NextResponse } from "next/server";
import { store } from "@/lib/db/store";
import { PROVIDERS } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function GET() {
  const [requests, providerStatusList] = await Promise.all([
    store.requests(),
    store.providerStatuses(),
  ]);
  const since = Date.now() - DAY_MS;

  /* ── Totals ── */
  let totalRequests = 0;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalTokens = 0;
  let totalCostUsd = 0;
  let totalFailovers = 0;
  let latencySum = 0;
  let errors = 0;
  let streamingRequests = 0;
  let cachedResponses = 0;
  let last24hRequests = 0;

  /* ── Per (model, provider) ── */
  const modelMap = new Map<
    string,
    {
      model: string;
      providers: Set<string>;
      requests: number;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      costUsd: number;
      latencySum: number;
      failovers: number;
      lastUsed: number;
    }
  >();

  /* ── Per provider ── */
  const providerMap = new Map<
    string,
    {
      requests: number;
      costUsd: number;
      failovers: number;
      latencySum: number;
      lastUsed: number;
    }
  >();

  for (const r of requests) {
    totalRequests += 1;
    totalPromptTokens += r.promptTokens;
    totalCompletionTokens += r.completionTokens;
    totalTokens += r.totalTokens;
    totalCostUsd += r.costUsd;
    totalFailovers += r.failovers;
    latencySum += r.latencyMs;
    if (r.statusCode !== 200) errors += 1;
    if (r.stream) streamingRequests += 1;
    if (r.cached) cachedResponses += 1;
    if (r.timestamp.getTime() >= since) last24hRequests += 1;

    const ts = r.timestamp.getTime();

    const mk = r.servedModel || "unknown";
    const me = modelMap.get(mk) ?? {
      model: mk,
      providers: new Set<string>(),
      requests: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      latencySum: 0,
      failovers: 0,
      lastUsed: 0,
    };
    me.providers.add(r.provider);
    me.requests += 1;
    me.promptTokens += r.promptTokens;
    me.completionTokens += r.completionTokens;
    me.totalTokens += r.totalTokens;
    me.costUsd += r.costUsd;
    me.latencySum += r.latencyMs;
    me.failovers += r.failovers;
    if (ts > me.lastUsed) me.lastUsed = ts;
    modelMap.set(mk, me);

    const pk = r.provider || "unknown";
    const pe = providerMap.get(pk) ?? {
      requests: 0,
      costUsd: 0,
      failovers: 0,
      latencySum: 0,
      lastUsed: 0,
    };
    pe.requests += 1;
    pe.costUsd += r.costUsd;
    pe.failovers += r.failovers;
    pe.latencySum += r.latencyMs;
    if (ts > pe.lastUsed) pe.lastUsed = ts;
    providerMap.set(pk, pe);
  }

  const perModel = [...modelMap.values()]
    .map((m) => ({
      model: m.model,
      providers: [...m.providers],
      requests: m.requests,
      promptTokens: m.promptTokens,
      completionTokens: m.completionTokens,
      totalTokens: m.totalTokens,
      costUsd: m.costUsd,
      avgLatencyMs: m.requests > 0 ? Math.round(m.latencySum / m.requests) : null,
      failovers: m.failovers,
      lastUsed: m.lastUsed > 0 ? new Date(m.lastUsed) : null,
    }))
    .sort((a, b) => b.requests - a.requests);

  const providerMeta = PROVIDERS.map((p) => ({
    id: p.id,
    label: p.label,
    configured: p.apiKey.length > 0,
    models: p.models.map((m) => m.id),
    homeUrl: p.homeUrl,
  }));

  const statusMap = new Map(providerStatusList.map((s) => [s.provider, s]));

  const perProvider = providerMeta.map((meta) => {
    const agg = providerMap.get(meta.id);
    const st = statusMap.get(meta.id);
    return {
      ...meta,
      requests: agg?.requests ?? 0,
      avgLatencyMs:
        agg && agg.requests > 0
          ? Math.round(agg.latencySum / agg.requests)
          : st?.latencyMs ?? null,
      costUsd: agg?.costUsd ?? 0,
      failovers: agg?.failovers ?? 0,
      lastUsed: agg && agg.lastUsed > 0 ? new Date(agg.lastUsed) : st?.lastCheck ?? null,
      status: st?.status ?? "unknown",
      successes: st?.successes ?? 0,
      failures: st?.failures ?? 0,
      lastError: st?.lastError ?? null,
    };
  });

  const recent = [...requests]
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    .slice(0, 80)
    .map((r) => ({
      id: r.id,
      timestamp: r.timestamp,
      requestedModel: r.requestedModel,
      servedModel: r.servedModel,
      provider: r.provider,
      statusCode: r.statusCode,
      stream: r.stream,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      totalTokens: r.totalTokens,
      costUsd: r.costUsd,
      latencyMs: r.latencyMs,
      ttftMs: r.ttftMs,
      failovers: r.failovers,
      error: r.error,
      client: r.client,
      cached: r.cached,
    }));

  return NextResponse.json({
    updatedAt: new Date().toISOString(),
    summary: {
      totalRequests,
      totalPromptTokens,
      totalCompletionTokens,
      totalTokens,
      totalCostUsd,
      totalFailovers,
      avgLatencyMs: totalRequests > 0 ? Math.round(latencySum / totalRequests) : null,
      errors,
      successRate:
        totalRequests > 0 ? Math.round(((totalRequests - errors) / totalRequests) * 1000) / 10 : 100,
      last24hRequests,
      streamingRequests,
      cachedResponses,
    },
    perModel,
    perProvider,
    recent,
  });
}
