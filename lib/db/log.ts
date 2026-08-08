import { store } from "@/lib/db/store";
import { estimateCost } from "@/lib/ai/pricing";
import type { ProviderId } from "@/lib/config";

export interface LogRequestInput {
  requestedModel: string;
  servedModel: string;
  provider: ProviderId | string;
  statusCode: number;
  stream: boolean;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  ttftMs?: number | null;
  failovers: number;
  error?: string | null;
  client?: string | null;
  cached?: boolean;
}

/**
 * Persist one API call to the JSON store. Never throws — logging must not
 * break a live request. Fire-and-forget callers wrap this with `.catch(() => {})`
 * where needed.
 */
export async function logRequest(input: LogRequestInput): Promise<void> {
  const { provider, servedModel } = input;
  const costUsd = estimateCost(
    provider as ProviderId,
    servedModel,
    input.promptTokens,
    input.completionTokens,
  );
  await store.addRequest({
    requestedModel: input.requestedModel.slice(0, 200),
    servedModel: servedModel.slice(0, 200),
    provider: String(provider).slice(0, 50),
    statusCode: input.statusCode,
    stream: input.stream,
    promptTokens: input.promptTokens,
    completionTokens: input.completionTokens,
    totalTokens: input.promptTokens + input.completionTokens,
    costUsd,
    latencyMs: input.latencyMs,
    ttftMs: input.ttftMs ?? null,
    failovers: input.failovers,
    error: input.error ? input.error.slice(0, 500) : null,
    client: input.client ? input.client.slice(0, 64) : null,
    cached: input.cached ?? false,
  });
}

/** Safe wrapper for fire-and-forget logging. */
export function logRequestSafe(input: LogRequestInput): void {
  logRequest(input).catch((e) => {
    console.error("[store] failed to log request:", e);
  });
}

export type ProviderHealth = "online" | "degraded" | "offline" | "unknown";

async function currentCounters(provider: string): Promise<{
  successes: number;
  failures: number;
}> {
  const list = await store.providerStatuses();
  const prev = list.find((s) => s.provider === provider);
  return { successes: prev?.successes ?? 0, failures: prev?.failures ?? 0 };
}

export async function recordProviderSuccess(
  provider: string,
  latencyMs?: number,
  model?: string,
): Promise<void> {
  const { successes } = await currentCounters(provider);
  await store.upsertProviderStatus(provider, {
    status: "online",
    latencyMs: latencyMs ?? null,
    successes: successes + 1,
    lastModel: model,
    lastError: null,
  });
}

export async function recordProviderFailure(
  provider: string,
  error?: string,
): Promise<void> {
  const { failures } = await currentCounters(provider);
  await store.upsertProviderStatus(provider, {
    failures: failures + 1,
    lastError: error?.slice(0, 500) ?? null,
    status: "degraded",
  });
}

export async function setProviderStatus(
  provider: string,
  status: ProviderHealth,
  latencyMs?: number | null,
  model?: string,
  error?: string,
): Promise<void> {
  const counters = await currentCounters(provider);
  await store.upsertProviderStatus(provider, {
    status,
    latencyMs: latencyMs ?? null,
    lastModel: model,
    lastError: error?.slice(0, 500) ?? null,
    successes: counters.successes,
    failures: counters.failures,
  });
}
