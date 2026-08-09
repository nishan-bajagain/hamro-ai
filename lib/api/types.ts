/**
 * Types for the Hamro AI gateway API — the shapes the /v1/* and /api/*
 * endpoints actually return (see API_AUDIT.md).
 */

export interface ApiChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ApiModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
  context_length?: number;
  pricing?: { input: string; output: string };
}

export interface ApiModelList {
  object: "list";
  data: ApiModel[];
}

export interface ApiChatSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface ApiChat extends ApiChatSummary {
  messages: ApiChatMessage[];
}

export interface ApiChatList {
  chats: ApiChatSummary[];
}

/** The OpenAI-style error body every gateway endpoint returns on failure. */
export interface ApiErrorBody {
  error: {
    message: string;
    type: string;
    param: string | null;
    code: string | number | null;
  };
}

/** Routing diagnostics the gateway exposes via X-Gateway-* headers. */
export interface StreamMeta {
  provider: string;
  model: string;
  sessionModel: string | null;
  failovers: number;
  cached: boolean;
  ttftMs: number;
  totalMs: number;
}

/** Health probe shape (GET /api/health). */
export interface ApiHealth {
  status: "ok" | "degraded";
  service: string;
  uptimeSeconds: number;
  totalRequests: number;
  providers: {
    id: string;
    status: string;
    latencyMs: number | null;
    lastCheck: string | null;
  }[];
  ts: string;
}
