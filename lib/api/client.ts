"use client";

import { CLIENT_API_KEY } from "@/lib/client-config";
import type {
  ApiChat,
  ApiChatList,
  ApiChatMessage,
  ApiChatSummary,
  ApiErrorBody,
  ApiHealth,
  ApiModel,
  ApiModelList,
  StreamMeta,
} from "./types";

/**
 * Centralized Hamro AI API client.
 *
 * Every gateway endpoint is reached through `request()` so auth headers,
 * error normalization, and timeouts live in exactly one place. The public
 * access key is the shared gateway key (see client-config.ts) — it is meant
 * to be used from the browser; no private secrets ever appear here.
 */

export class ApiClientError extends Error {
  status: number;
  code: string | number | null;

  constructor(message: string, status: number, code: string | number | null = null) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
  }
}

const TIMEOUT_MS = 120_000;

/** Stable per-browser session id — keeps the `random` model pinned across reloads. */
function sessionId(): string {
  try {
    let id = localStorage.getItem("hamro.session-id");
    if (!id) {
      id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem("hamro.session-id", id);
    }
    return id;
  } catch {
    return "browser-session";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(path, {
      ...init,
      headers: {
        Authorization: `Bearer ${CLIENT_API_KEY}`,
        "x-session-id": sessionId(),
        "x-client": "hamro-ai-web",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
      signal: init.signal ?? ctrl.signal,
      cache: "no-store",
    });

    if (!res.ok) {
      let body: ApiErrorBody | null = null;
      try {
        body = (await res.json()) as ApiErrorBody;
      } catch {
        /* non-JSON error body */
      }
      const raw = body?.error?.message;
      throw new ApiClientError(
        friendlyMessage(res.status, raw, body?.error?.code ?? null),
        res.status,
        body?.error?.code ?? null,
      );
    }
    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof ApiClientError) throw e;
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new ApiClientError(
        "The request timed out. Please try again.",
        408,
        "timeout",
      );
    }
    throw new ApiClientError(
      "Unable to connect to Hamro AI. Please check your connection and try again.",
      0,
      "network_error",
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Turn a raw HTTP status into a friendly, human-readable message. */
function friendlyMessage(
  status: number,
  raw: string | null | undefined,
  code: string | number | null,
): string {
  switch (status) {
    case 401:
      return "Invalid API key. Check your access key and try again.";
    case 403:
      return "Access denied by the gateway. Check your API key.";
    case 404:
      return code === "chat_not_found"
        ? "That conversation no longer exists."
        : "That model is no longer available. Pick another one from the model selector.";
    case 408:
      return "The request timed out. Please try again.";
    case 429:
      return "Rate limit reached — the gateway is busy. Wait a moment and try again.";
    case 499:
      return "The request was cancelled.";
    case 500:
      return "The gateway hit an internal error. Please try again.";
    case 502:
      return "Every provider failed to answer. Please try again in a moment.";
    default:
      return raw || "Something went wrong. Please try again.";
  }
}

/* ─────────────────────────── model service ─────────────────────────── */

export async function listModels(): Promise<ApiModel[]> {
  const data = await request<ApiModelList>("/v1/models");
  return data.data;
}

/* ─────────────────────────── chat service ──────────────────────────── */

export interface StreamChatOptions {
  model: string;
  messages: ApiChatMessage[];
  onDelta: (delta: string) => void;
  signal?: AbortSignal;
}

export interface StreamChatResult {
  full: string;
  meta: StreamMeta;
}

/**
 * Stream a chat completion via SSE from POST /v1/chat/completions.
 * Resolves when the stream ends (or the caller aborts the signal).
 */
export async function streamChat({
  model,
  messages,
  onDelta,
  signal,
}: StreamChatOptions): Promise<StreamChatResult> {
  const t0 = performance.now();
  const res = await fetch("/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CLIENT_API_KEY}`,
      "x-session-id": sessionId(),
      "x-client": "hamro-ai-web",
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
    }),
    signal,
    cache: "no-store",
  });

  const meta: StreamMeta = {
    provider: res.headers.get("x-gateway-provider") ?? "",
    model: res.headers.get("x-gateway-model") ?? model,
    sessionModel: res.headers.get("x-gateway-session-model"),
    failovers: Number(res.headers.get("x-gateway-failovers") ?? "0"),
    cached: (res.headers.get("x-gateway-cache") ?? "") === "HIT",
    ttftMs: 0,
    totalMs: 0,
  };

  if (!res.ok) {
    let raw: string | null = null;
    let code: string | number | null = null;
    try {
      const body = (await res.json()) as ApiErrorBody;
      raw = body.error?.message ?? null;
      code = body.error?.code ?? null;
    } catch {
      /* ignore */
    }
    throw new ApiClientError(friendlyMessage(res.status, raw, code), res.status, code);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new ApiClientError("The gateway returned an empty response.", 502);

  const decoder = new TextDecoder();
  let buf = "";
  let full = "";
  let ttft = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload) as {
          error?: { message?: string };
          choices?: { delta?: { content?: string | null } }[];
        };
        if (json.error?.message) {
          throw new ApiClientError(
            friendlyMessage(502, json.error.message, null),
            502,
          );
        }
        const delta = json.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta) {
          if (!ttft) ttft = performance.now() - t0;
          full += delta;
          onDelta(delta);
        }
      } catch (e) {
        if (e instanceof ApiClientError) throw e;
        /* malformed line — skip */
      }
    }
  }

  meta.ttftMs = ttft;
  meta.totalMs = performance.now() - t0;
  return { full, meta };
}

/* ─────────────────────── conversation service ──────────────────────── */

/** Summaries for the sidebar (no message bodies). */
export async function listChats(): Promise<ApiChatSummary[]> {
  const data = await request<ApiChatList>("/api/chats");
  return data.chats;
}

/** One full conversation, messages included. */
export async function getChat(id: string): Promise<ApiChat> {
  return request<ApiChat>(`/api/chats/${encodeURIComponent(id)}`);
}

/** Create or update a conversation. */
export async function saveChat(chat: {
  id?: string;
  title: string;
  messages: ApiChatMessage[];
}): Promise<ApiChatSummary> {
  const data = await request<{ chats: ApiChatSummary[] }>("/api/chats", {
    method: "POST",
    body: JSON.stringify(chat),
  });
  return data.chats[0];
}

export async function deleteChat(id: string): Promise<void> {
  await request<null>(`/api/chats/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function clearChats(): Promise<void> {
  await request<null>("/api/chats", { method: "DELETE" });
}

export async function checkHealth(): Promise<ApiHealth | null> {
  try {
    // The gateway reports 503 when degraded — still a valid health payload.
    const res = await fetch("/api/health", { cache: "no-store" });
    if (res.status !== 200 && res.status !== 503) return null;
    return (await res.json()) as ApiHealth;
  } catch {
    return null;
  }
}
