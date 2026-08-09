/**
 * Anthropic Messages API compatibility layer.
 *
 * Claude Code and other Anthropic-protocol clients speak `POST /v1/messages`
 * with content blocks, `{name, input_schema}` tools and SSE events
 * (`message_start` → `content_block_start`/`content_block_delta`/`content_block_stop`
 * → `message_delta` → `message_stop`). They cannot talk to an OpenAI-compatible
 * gateway directly.
 *
 * This module translates both directions so the gateway can serve Claude Code
 * natively: an Anthropic request is converted into the internal OpenAI request
 * (so it flows through the same smart router — failover, `random` session
 * pinning, caching, telemetry — as every other client), and the OpenAI
 * response / SSE stream is converted back into an Anthropic message / event
 * stream.
 */

import { estimateTokens } from "@/lib/ai/tokens";
import { SseParser } from "@/lib/ai/sse";
import type {
  ChatCompletion,
  ChatCompletionRequest,
  ChatMessage,
} from "@/lib/ai/types";

/* ─────────────────────────── Anthropic types ──────────────────────── */

export interface AnthropicContentBlock {
  type: string;
  text?: string;
  /** tool_use */
  id?: string;
  name?: string;
  input?: unknown;
  /** tool_result */
  tool_use_id?: string;
  is_error?: boolean;
  content?: string | AnthropicContentBlock[];
  /** thinking / redacted_thinking (dropped on the OpenAI hop) */
  thinking?: string;
  signature?: string;
}

export interface AnthropicMessage {
  role: "user" | "assistant" | "system";
  content: string | AnthropicContentBlock[];
}

export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema?: Record<string, unknown>;
}

export type AnthropicToolChoice =
  | { type: "auto" }
  | { type: "any" }
  | { type: "tool"; name?: string }
  | string;

export interface AnthropicRequest {
  model?: string;
  system?: string | AnthropicContentBlock[];
  messages?: AnthropicMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  stream?: boolean;
  tools?: AnthropicTool[];
  tool_choice?: AnthropicToolChoice;
  metadata?: { user_id?: string };
}

export interface AnthropicMessageResponse {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: AnthropicContentBlock[];
  stop_reason: string | null;
  stop_sequence: string | null;
  usage: { input_tokens: number; output_tokens: number };
}

/* ──────────────────────────── Translation ─────────────────────────── */

/** Flatten Anthropic `content` (string or text blocks) to plain text. */
function textFromContent(content: string | AnthropicContentBlock[] | undefined): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n");
}

/**
 * Convert an Anthropic `/v1/messages` request into the internal
 * OpenAI-compatible request so it can be routed like any other client.
 */
export function buildOpenAIRequest(body: AnthropicRequest): ChatCompletionRequest {
  const messages: ChatMessage[] = [];

  const systemText = textFromContent(body.system);
  if (systemText) messages.push({ role: "system", content: systemText });

  for (const m of body.messages ?? []) {
    if (typeof m.content === "string") {
      messages.push({ role: m.role, content: m.content });
      continue;
    }

    const texts: string[] = [];
    const toolCalls: {
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    }[] = [];
    const toolResults: ChatMessage[] = [];

    for (const b of m.content ?? []) {
      if (b.type === "text" && typeof b.text === "string") {
        texts.push(b.text);
      } else if (b.type === "tool_use" && b.id && b.name) {
        toolCalls.push({
          id: b.id,
          type: "function",
          function: {
            name: b.name,
            arguments: JSON.stringify(b.input ?? {}),
          },
        });
      } else if (b.type === "tool_result" && b.tool_use_id) {
        const content =
          typeof b.content === "string" ? b.content : textFromContent(b.content);
        toolResults.push({
          role: "tool",
          tool_call_id: b.tool_use_id,
          content: content || "",
        });
      }
      // thinking / redacted_thinking / image blocks are intentionally dropped.
    }

    const text = texts.join("\n");
    if (m.role === "assistant") {
      if (text) {
        messages.push({
          role: "assistant",
          content: text,
          ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        });
      } else if (toolCalls.length) {
        messages.push({ role: "assistant", content: null, tool_calls: toolCalls });
      }
    } else if (m.role === "system") {
      // Claude Code sometimes puts a `system` role message inside `messages`
      // (in addition to the top-level `system` field) — keep it as a system
      // message so the prompt is not lost on the OpenAI hop.
      if (text) messages.push({ role: "system", content: text });
    } else if (text) {
      messages.push({ role: "user", content: text });
    }
    messages.push(...toolResults);
  }

  const tools = body.tools?.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description ?? "",
      parameters:
        t.input_schema ?? { type: "object", properties: {} },
    },
  }));

  let toolChoice: unknown;
  const tc = body.tool_choice;
  if (tc && typeof tc === "object") {
    if (tc.type === "auto") toolChoice = "auto";
    else if (tc.type === "any") toolChoice = "required";
    else if (tc.type === "tool")
      toolChoice = { type: "function", function: { name: tc.name } };
  } else if (typeof tc === "string") {
    toolChoice = tc;
  }

  return {
    model: body.model?.trim() || "random",
    messages,
    stream: body.stream,
    ...(typeof body.temperature === "number" ? { temperature: body.temperature } : {}),
    ...(typeof body.top_p === "number" ? { top_p: body.top_p } : {}),
    max_tokens: body.max_tokens ?? 4096,
    ...(body.stop_sequences?.length
      ? { stop: body.stop_sequences.length === 1 ? body.stop_sequences[0] : body.stop_sequences }
      : {}),
    ...(tools?.length ? { tools } : {}),
    ...(toolChoice !== undefined ? { tool_choice: toolChoice } : {}),
    ...(body.metadata?.user_id ? { user: body.metadata.user_id } : {}),
  };
}

/** Map an OpenAI finish_reason to an Anthropic stop_reason. */
function mapStopReason(finishReason: string | null | undefined): string | null {
  switch (finishReason) {
    case "tool_calls":
      return "tool_use";
    case "length":
      return "max_tokens";
    case "stop":
      return "end_turn";
    default:
      return finishReason || "end_turn";
  }
}

/**
 * Convert a non-streaming OpenAI completion into an Anthropic message.
 * `fallbackInputTokens` / `fallbackOutputTokens` are used when the upstream
 * did not report usage.
 */
export function openaiToAnthropicMessage(
  completion: ChatCompletion,
  requestedModel: string,
  fallback: { inputTokens: number; outputTokens: number },
): AnthropicMessageResponse {
  const choice = completion.choices?.[0];
  const message = choice?.message;
  const content: AnthropicContentBlock[] = [];

  const text = typeof message?.content === "string" ? message.content : "";
  if (text) content.push({ type: "text", text });

  const toolCalls = (message?.tool_calls ?? []) as {
    id?: string;
    function?: { name?: string; arguments?: string };
  }[];
  for (const tc of toolCalls) {
    let input: unknown = {};
    if (tc.function?.arguments) {
      try {
        input = JSON.parse(tc.function.arguments);
      } catch {
        input = tc.function.arguments;
      }
    }
    content.push({
      type: "tool_use",
      id: tc.id ?? `toolu_${Math.random().toString(36).slice(2, 12)}`,
      name: tc.function?.name ?? "tool",
      input,
    });
  }

  return {
    id:
      completion.id?.replace(/^chatcmpl-/, "msg_") ??
      `msg_${crypto.randomUUID()}`,
    type: "message",
    role: "assistant",
    model: requestedModel,
    content,
    stop_reason: mapStopReason(choice?.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: completion.usage?.prompt_tokens ?? fallback.inputTokens,
      output_tokens:
        completion.usage?.completion_tokens ?? fallback.outputTokens,
    },
  };
}

/* ────────────────────────── Streaming (SSE) ───────────────────────── */

const TEXT_DELTA = "text_delta";
const INPUT_JSON_DELTA = "input_json_delta";

/**
 * Wrap the router's OpenAI SSE stream (`data: {…}` lines) and re-emit it as
 * an Anthropic event stream (message_start → content_block_* → message_delta
 * → message_stop) that Claude Code's parser accepts. Tool calls are buffered
 * into `tool_use` blocks with `input_json_delta` argument deltas.
 */
export function createAnthropicStream(
  openaiStream: ReadableStream<Uint8Array>,
  requestedModel: string,
  inputTokensEstimate: number,
): ReadableStream<Uint8Array> {
  const parser = new SseParser();
  const enc = new TextEncoder();
  const msgId = `msg_${crypto.randomUUID()}`;

  let started = false;
  let inputTokens = inputTokensEstimate;
  let outputTokens = 0;
  let stopReason: string | null = null;
  let collectedText = "";
  let stopped = false;
  let blockOpen: { index: number; type: "text" | "tool_use" } | null = null;

  const emit = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    event: string,
    data: unknown,
  ) => {
    controller.enqueue(
      enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
    );
  };

  const closeBlock = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (blockOpen) {
      emit(controller, "content_block_stop", { index: blockOpen.index });
      blockOpen = null;
    }
  };

  const openTextBlock = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    closeBlock(controller);
    emit(controller, "content_block_start", {
      index: 0,
      content_block: { type: "text", text: "" },
    });
    blockOpen = { index: 0, type: "text" };
  };

  const ensureStarted = (controller: ReadableStreamDefaultController<Uint8Array>, promptTokens?: number) => {
    if (started) return;
    started = true;
    if (typeof promptTokens === "number") inputTokens = promptTokens;
    emit(controller, "message_start", {
      type: "message_start",
      message: {
        id: msgId,
        type: "message",
        role: "assistant",
        model: requestedModel,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: inputTokens, output_tokens: 0 },
      },
    });
  };

  const finish = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (stopped) return;
    stopped = true;
    if (!started) ensureStarted(controller);
    if (!blockOpen) {
      // Anthropic parsers expect at least one content block even for empty output.
      openTextBlock(controller);
    }
    closeBlock(controller);
    emit(controller, "message_delta", {
      type: "message_delta",
      delta: { stop_reason: stopReason ?? "end_turn", stop_sequence: null },
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens || estimateTokens(collectedText),
      },
    });
    emit(controller, "message_stop", { type: "message_stop" });
  };

  const handlePayload = (
    payload: string,
    controller: ReadableStreamDefaultController<Uint8Array>,
  ) => {
    if (stopped || payload === "[DONE]") return;
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      return; // non-JSON passthrough line — nothing to translate
    }
    if (json.error) {
      stopped = true;
      emit(controller, "error", {
        type: "error",
        error: {
          type: "api_error",
          message:
            (json.error as { message?: string }).message ?? "Upstream stream error",
        },
      });
      return;
    }
    if (typeof json.usage === "object" && json.usage) {
      const u = json.usage as { prompt_tokens?: number; completion_tokens?: number };
      if (typeof u.prompt_tokens === "number") inputTokens = u.prompt_tokens;
      if (typeof u.completion_tokens === "number") outputTokens = u.completion_tokens;
    }
    ensureStarted(controller, inputTokens);

    const choices = (json.choices ?? []) as {
      delta?: {
        content?: string | null;
        tool_calls?: {
          index?: number;
          id?: string;
          function?: { name?: string; arguments?: string };
        }[];
      };
      finish_reason?: string | null;
    }[];
    const choice = choices[0];
    const delta = choice?.delta;

    if (choice?.finish_reason) {
      stopReason = mapStopReason(choice.finish_reason);
    }

    if (delta && typeof delta.content === "string" && delta.content.length > 0) {
      if (!blockOpen || blockOpen.type !== "text") openTextBlock(controller);
      collectedText += delta.content;
      emit(controller, "content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: TEXT_DELTA, text: delta.content },
      });
    }

    for (const tc of delta?.tool_calls ?? []) {
      const name = tc.function?.name;
      const args = tc.function?.arguments;
      const isNewBlock =
        !blockOpen ||
        blockOpen.type !== "tool_use" ||
        (name && tc.id === undefined && blockOpen.index !== (tc.index ?? 0));
      if (isNewBlock) {
        closeBlock(controller);
        const index = tc.index ?? 0;
        emit(controller, "content_block_start", {
          index,
          content_block: {
            type: "tool_use",
            id: tc.id ?? `toolu_${Math.random().toString(36).slice(2, 12)}`,
            name: name ?? "tool",
            input: {},
          },
        });
        blockOpen = { index, type: "tool_use" };
      }
      if (typeof args === "string" && args.length > 0) {
        emit(controller, "content_block_delta", {
          type: "content_block_delta",
          index: blockOpen?.index ?? 0,
          delta: { type: INPUT_JSON_DELTA, partial_json: args },
        });
      }
    }
  };

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const reader = openaiStream.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const payload of parser.feed(value)) {
            handlePayload(payload, controller);
          }
        }
        for (const payload of parser.flush()) {
          handlePayload(payload, controller);
        }
        finish(controller);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      } catch (e) {
        if (!stopped) {
          stopped = true;
          try {
            emit(controller, "error", {
              type: "error",
              error: {
                type: "api_error",
                message: e instanceof Error ? e.message : "Upstream stream error",
              },
            });
          } catch {
            /* client gone */
          }
        }
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      stopped = true;
      try {
        void openaiStream.cancel();
      } catch {
        /* ignore */
      }
    },
  });
}
