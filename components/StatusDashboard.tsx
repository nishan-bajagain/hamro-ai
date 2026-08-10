"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Clock,
  Coins,
  Database,
  Layers,
  Radio,
  RefreshCw,
  Server,
  ShieldAlert,
  Terminal,
  Zap,
} from "lucide-react";
import { Badge, Card, Spinner, StatCard, StatusDot } from "@/components/ui";

/* ─────────────────────────── types ─────────────────────────── */

interface StatusPayload {
  updatedAt: string;
  summary: {
    totalRequests: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalTokens: number;
    totalCostUsd: number;
    totalFailovers: number;
    avgLatencyMs: number | null;
    errors: number;
    successRate: number;
    last24hRequests: number;
    streamingRequests: number;
  };
  perModel: {
    model: string;
    providers: string[];
    requests: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd: number;
    avgLatencyMs: number | null;
    failovers: number;
    lastUsed: string | null;
  }[];
  perProvider: {
    id: string;
    label: string;
    configured: boolean;
    models: string[];
    homeUrl: string;
    requests: number;
    avgLatencyMs: number | null;
    costUsd: number;
    failovers: number;
    lastUsed: string | null;
    status: "online" | "degraded" | "offline" | "unknown";
    successes: number;
    failures: number;
    lastError: string | null;
  }[];
  recent: {
    id: string;
    timestamp: string;
    requestedModel: string;
    servedModel: string;
    provider: string;
    statusCode: number;
    stream: boolean;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd: number;
    latencyMs: number;
    ttftMs: number | null;
    failovers: number;
    error: string | null;
    client: string | null;
  }[];
}

const POLL_MS = 4000;
const HEALTH_MS = 30_000;

/* ─────────────────────────── component ─────────────────────────── */

export function StatusDashboard() {
  const [data, setData] = useState<StatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [healthRunning, setHealthRunning] = useState(false);
  const [healthNote, setHealthNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      if (!res.ok) throw new Error(`status ${res.status}`);
      setData((await res.json()) as StatusPayload);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load status");
    } finally {
      setLoading(false);
    }
  }, []);

  const runHealth = useCallback(async () => {
    setHealthRunning(true);
    setHealthNote(null);
    try {
      const res = await fetch("/api/healthcheck", { method: "POST" });
      if (res.status === 409) {
        setHealthNote("Health check already in progress…");
      } else if (!res.ok) {
        setHealthNote(`Health check failed (${res.status})`);
      } else {
        const out = (await res.json()) as {
          results: { provider: string; status: string; latencyMs: number }[];
        };
        const text = out.results
          .map((r) => `${r.provider}=${r.status}${r.latencyMs ? `(${r.latencyMs}ms)` : ""}`)
          .join(" · ");
        setHealthNote(text);
      }
      await refresh();
    } catch {
      setHealthNote("Health check failed");
    } finally {
      setHealthRunning(false);
    }
  }, [refresh]);

  useEffect(() => {
    const t0 = setTimeout(() => void refresh(), 0);
    const t1 = setInterval(() => void refresh(), POLL_MS);
    const t2 = setInterval(() => void runHealth(), HEALTH_MS);
    return () => {
      clearTimeout(t0);
      clearInterval(t1);
      clearInterval(t2);
    };
  }, [refresh, runHealth]);

  const s = data?.summary;
  const providers = data?.perProvider ?? [];

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-50">
            Gateway Status
          </h1>
          <p className="mt-1 text-sm text-muted">
            Real-time telemetry for every request routed through hamro.site.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {error && (
            <span className="text-xs text-red-400">{error}</span>
          )}
          {data && (
            <span className="font-mono text-[11px] text-faint">
              updated {timeAgo(data.updatedAt)}
            </span>
          )}
          <button
            onClick={() => void runHealth()}
            disabled={healthRunning}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-edge bg-panel px-3 text-sm text-zinc-200 transition-colors hover:border-edge-2 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${healthRunning ? "animate-spin" : ""}`} />
            Health check
          </button>
        </div>
      </div>

      {healthNote && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-cyan-500/25 bg-cyan-500/10 px-3 py-2 font-mono text-xs text-cyan-300">
          <Radio className="h-3.5 w-3.5" /> {healthNote}
        </div>
      )}

      {!data && loading ? (
        <div className="flex h-64 items-center justify-center text-muted">
          <Spinner className="h-6 w-6" />
        </div>
      ) : !s ? (
        <div className="rounded-xl border border-edge bg-panel p-8 text-center text-sm text-muted">
          No telemetry yet — make your first request to <code className="font-mono text-zinc-300">/v1/chat/completions</code>.
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard
              label="Total requests"
              value={s.totalRequests.toLocaleString()}
              sub={`${s.last24hRequests.toLocaleString()} in last 24h`}
              icon={<Activity className="h-3.5 w-3.5 text-emerald-400" />}
              accent="text-emerald-300"
            />
            <StatCard
              label="Tokens consumed"
              value={fmtNum(s.totalTokens)}
              sub={`${fmtNum(s.totalPromptTokens)} in · ${fmtNum(s.totalCompletionTokens)} out`}
              icon={<Database className="h-3.5 w-3.5 text-cyan-400" />}
              accent="text-cyan-300"
            />
            <StatCard
              label="Est. cost accrued"
              value={fmtUsd(s.totalCostUsd)}
              sub="from standard pricing tables"
              icon={<Coins className="h-3.5 w-3.5 text-amber-400" />}
              accent="text-amber-300"
            />
            <StatCard
              label="Avg latency"
              value={s.avgLatencyMs ? `${s.avgLatencyMs.toFixed(0)}ms` : "—"}
              sub="per request"
              icon={<Clock className="h-3.5 w-3.5 text-violet-400" />}
            />
            <StatCard
              label="Success rate"
              value={`${s.successRate}%`}
              sub={`${s.errors} errors`}
              icon={<Zap className="h-3.5 w-3.5 text-emerald-400" />}
              accent="text-emerald-300"
            />
            <StatCard
              label="Failovers"
              value={s.totalFailovers.toLocaleString()}
              sub={`${s.streamingRequests} streamed`}
              icon={<Layers className="h-3.5 w-3.5 text-orange-400" />}
              accent="text-orange-300"
            />
          </div>

          {/* Provider health grid */}
          <h2 className="mb-3 mt-7 text-sm font-semibold uppercase tracking-wider text-muted">
            Provider health
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {providers.map((p) => (
              <ProviderCard key={p.id} p={p} />
            ))}
          </div>

          {/* Model stats */}
          <h2 className="mb-3 mt-7 text-sm font-semibold uppercase tracking-wider text-muted">
            Per-model usage
          </h2>
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-edge text-[11px] uppercase tracking-wider text-faint">
                    <Th>Model</Th>
                    <Th>Provider</Th>
                    <Th className="text-right">Requests</Th>
                    <Th className="text-right">Tokens</Th>
                    <Th className="text-right">Cost</Th>
                    <Th className="text-right">Avg latency</Th>
                    <Th className="text-right">Failovers</Th>
                    <Th className="text-right">Last used</Th>
                  </tr>
                </thead>
                <tbody>
                  {(data.perModel.length ? data.perModel : []).map((m) => (
                    <tr
                      key={m.model}
                      className="border-b border-edge/60 last:border-0 hover:bg-panel-2/60"
                    >
                      <Td mono>{m.model}</Td>
                      <Td>{m.providers.join(", ")}</Td>
                      <Td className="text-right font-mono">{m.requests.toLocaleString()}</Td>
                      <Td className="text-right font-mono">{fmtNum(m.totalTokens)}</Td>
                      <Td className="text-right font-mono text-amber-300">
                        {fmtUsd(m.costUsd)}
                      </Td>
                      <Td className="text-right font-mono">
                        {m.avgLatencyMs ? `${m.avgLatencyMs.toFixed(0)}ms` : "—"}
                      </Td>
                      <Td className="text-right font-mono">
                        {m.failovers > 0 ? (
                          <span className="text-orange-300">{m.failovers}</span>
                        ) : (
                          "0"
                        )}
                      </Td>
                      <Td className="text-right text-xs text-faint">
                        {m.lastUsed ? timeAgo(m.lastUsed) : "—"}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Live event log */}
          <h2 className="mb-3 mt-7 text-sm font-semibold uppercase tracking-wider text-muted">
            Live event log
          </h2>
          <Card>
            <div className="max-h-[480px] overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 z-10 bg-panel">
                  <tr className="border-b border-edge text-[11px] uppercase tracking-wider text-faint">
                    <Th>Time</Th>
                    <Th>Status</Th>
                    <Th>Client</Th>
                    <Th>Requested → served</Th>
                    <Th className="text-right">Latency</Th>
                    <Th className="text-right">Tokens</Th>
                    <Th className="text-right">Cost</Th>
                    <Th>Notes</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-edge/50 last:border-0 hover:bg-panel-2/60"
                    >
                      <Td className="whitespace-nowrap font-mono text-faint">
                        {timeOf(r.timestamp)}
                      </Td>
                      <Td>
                        <StatusCodeBadge code={r.statusCode} failovers={r.failovers} />
                      </Td>
                      <Td>
                        <span className="text-zinc-300">{r.client ?? "—"}</span>
                      </Td>
                      <Td>
                        <span className="font-mono text-zinc-300">{shortModel(r.servedModel)}</span>
                        {r.servedModel !== r.requestedModel && (
                          <span className="ml-1 text-faint">← {shortModel(r.requestedModel)}</span>
                        )}
                        {r.provider && (
                          <span className="ml-1.5 text-[10px] text-cyan-400/80">{r.provider}</span>
                        )}
                      </Td>
                      <Td className="text-right font-mono">
                        {r.latencyMs > 0 ? `${r.latencyMs}ms` : "—"}
                        {r.ttftMs ? <span className="text-faint"> · ttft {r.ttftMs}ms</span> : null}
                      </Td>
                      <Td className="text-right font-mono text-faint">
                        {r.totalTokens > 0 ? r.totalTokens.toLocaleString() : "—"}
                      </Td>
                      <Td className="text-right font-mono text-amber-300/80">
                        {r.costUsd > 0 ? fmtUsd(r.costUsd) : "—"}
                      </Td>
                      <Td>
                        {r.error && (
                          <span className="flex items-center gap-1 text-red-400">
                            <AlertTriangle className="h-3 w-3 shrink-0" />
                            <span className="max-w-[260px] truncate">{r.error}</span>
                          </span>
                        )}
                      </Td>
                    </tr>
                  ))}
                  {data.recent.length === 0 && (
                    <tr>
                      <Td colSpan={8} className="py-6 text-center text-faint">
                        No requests logged yet.
                      </Td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

/* ─────────────────────────── pieces ─────────────────────────── */

function ProviderCard({ p }: { p: StatusPayload["perProvider"][number] }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-panel-2">
            <Server className="h-4 w-4 text-zinc-300" />
          </div>
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
              {p.label}
              <StatusDot status={p.status} />
              <span className="text-[11px] font-medium capitalize text-muted">{p.status}</span>
            </div>
            <div className="mt-0.5 font-mono text-[10px] text-faint">
              {p.models.length} model{p.models.length === 1 ? "" : "s"} configured
            </div>
          </div>
        </div>
        {!p.configured && <Badge tone="red">no key</Badge>}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <MiniStat label="requests" value={p.requests.toLocaleString()} />
        <MiniStat
          label="avg latency"
          value={p.avgLatencyMs ? `${p.avgLatencyMs.toFixed(0)}ms` : "—"}
        />
        <MiniStat label="cost" value={fmtUsd(p.costUsd)} />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {p.models.map((m) => (
          <span
            key={m}
            className="rounded-md border border-edge bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400"
          >
            {m}
          </span>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-edge pt-2.5 text-[10px] text-faint">
        <span>
          ok {p.successes} · fail {p.failures} · failovers {p.failovers}
        </span>
        <span>{p.lastUsed ? timeAgo(p.lastUsed) : "no data"}</span>
      </div>
    </Card>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-panel-2 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-faint">{label}</div>
      <div className="mt-0.5 font-mono text-xs text-zinc-200">{value}</div>
    </div>
  );
}

function StatusCodeBadge({ code, failovers }: { code: number; failovers: number }) {
  const tone =
    code === 200
      ? "green"
      : code === 429
        ? "amber"
        : code === 499
          ? "zinc"
          : "red";
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge tone={tone as "green"} className="font-mono">
        {code}
      </Badge>
      {failovers > 0 && (
        <Badge tone="amber" className="font-mono">
          ↷{failovers}
        </Badge>
      )}
      {code === 499 && <ShieldAlert className="h-3 w-3 text-faint" />}
      {code === 200 && <Terminal className="h-3 w-3 text-emerald-400/70" />}
    </span>
  );
}

function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={`px-3 py-2 font-medium ${className}`}>{children}</th>
  );
}

function Td({
  children,
  className = "",
  mono,
  colSpan,
}: {
  children?: React.ReactNode;
  className?: string;
  mono?: boolean;
  colSpan?: number;
}) {
  return (
    <td colSpan={colSpan} className={`px-3 py-2 align-top ${mono ? "font-mono" : ""} ${className}`}>
      {children}
    </td>
  );
}

/* ─────────────────────────── formatters ─────────────────────────── */

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

/** Adaptive USD formatting — small amounts must not truncate to $0.0000. */
function fmtUsd(n: number): string {
  if (!n) return "$0";
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.001) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(6)}`;
}

function shortModel(id: string): string {
  if (!id) return "—";
  const short = id.includes("/") ? id.slice(id.indexOf("/") + 1) : id;
  return short.length > 30 ? `${short.slice(0, 30)}…` : short;
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 5_000) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}
