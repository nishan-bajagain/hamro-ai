import { NextResponse } from "next/server";
import { store } from "@/lib/db/store";
import { PROVIDERS } from "@/lib/config";
import { corsHeaders } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function GET() {
  const [requests, providerStatusList, counters] = await Promise.all([
    store.requests(),
    store.providerStatuses(),
    store.counters(),
  ]);

  // The incremental counters are authoritative (they survive request-log
  // pruning and the compact remote snapshot). Fall back to iterating the log
  // only if the counters have never been touched.
  const useCounters = counters.requests > 0;

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
  let successfulRequests = 0;

  if (useCounters) {
    totalRequests = counters.requests;
    totalPromptTokens = counters.promptTokens;
    totalCompletionTokens = counters.completionTokens;
    totalTokens = counters.totalTokens;
    totalCostUsd = counters.costUsd;
    totalFailovers = counters.failovers;
    // Latency sums only count successful responses (see store.ts) — divide by
    // the successful count, not the total, so "avg latency" is response time.
    latencySum = counters.latencySum;
    errors = counters.errors;
    streamingRequests = counters.streaming;
    cachedResponses = counters.cached;
    successfulRequests = Math.max(0, totalRequests - errors);
  } else {
    for (const r of requests) {
      totalRequests += 1;
      totalPromptTokens += r.promptTokens;
      totalCompletionTokens += r.completionTokens;
      totalTokens += r.totalTokens;
      totalCostUsd += r.costUsd;
      totalFailovers += r.failovers;
      if (r.statusCode !== 200) errors += 1;
      if (r.statusCode === 200) {
        successfulRequests += 1;
        latencySum += r.latencyMs;
      }
      if (r.stream) streamingRequests += 1;
      if (r.cached) cachedResponses += 1;
    }
  }

  // "Last 24h" is computed from the request log, not the monotonic counter:
  // the counter only ever increments, so it would keep counting requests that
  // have since aged out of the 24h window. The log is capped at 5,000 recent
  // records — far more than a day's volume at gateway scale — so this scan is
  // the accurate source. (If the log is ever saturated within 24h, the number
  // under-reports rather than over-reports.)
  const since24 = Date.now() - DAY_MS;
  let last24hRequests = 0;
  for (const r of requests) {
    if (r.timestamp.getTime() >= since24) last24hRequests += 1;
  }

  /* ── Per model ── */
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

  if (useCounters) {
    for (const [model, m] of Object.entries(counters.perModel)) {
      modelMap.set(model, {
        model,
        providers: new Set<string>(),
        requests: m.requests,
        promptTokens: m.promptTokens,
        completionTokens: m.completionTokens,
        totalTokens: m.totalTokens,
        costUsd: m.costUsd,
        latencySum: m.latencySum,
        failovers: m.failovers,
        lastUsed: m.lastUsed ? new Date(m.lastUsed).getTime() : 0,
      });
    }
    // Providers are not tracked per model inside counters; derive them from
    // the recent request tail (they only matter for display).
    for (const r of requests) {
      const me = modelMap.get(r.servedModel);
      me?.providers.add(r.provider);
    }
  } else {
    for (const r of requests) {
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
    }
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

  const providerMap = new Map<
    string,
    { requests: number; costUsd: number; failovers: number; latencySum: number; lastUsed: number }
  >();
  if (useCounters) {
    for (const [id, p] of Object.entries(counters.perProvider)) {
      providerMap.set(id, {
        requests: p.requests,
        costUsd: p.costUsd,
        failovers: p.failovers,
        latencySum: p.latencySum,
        lastUsed: p.lastUsed ? new Date(p.lastUsed).getTime() : 0,
      });
    }
  } else {
    for (const r of requests) {
      const ts = r.timestamp.getTime();
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
  }

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

  return NextResponse.json(
    {
      updatedAt: new Date().toISOString(),
    summary: {
      totalRequests,
      totalPromptTokens,
      totalCompletionTokens,
      totalTokens,
      totalCostUsd,
      totalFailovers,
      avgLatencyMs:
        successfulRequests > 0 ? Math.round(latencySum / successfulRequests) : null,
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
  }, { headers: corsHeaders() });
}
