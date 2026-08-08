import type { ChatMessage } from "@/lib/ai/types";

/**
 * Token estimation without a heavy tokenizer dependency.
 *
 * Uses a hybrid heuristic that is decently accurate for English / code:
 *  - code-like runs (symbols) ~ 3.2 chars/token
 *  - prose ~ 4 chars/token
 *  - whitespace collapses
 *
 * Good enough for cost tracking and usage telemetry; upstream `usage` fields
 * are preferred whenever the provider reports them.
 */

export function estimateTokens(text: string): number {
  if (!text) return 0;
  const trimmed = text.trim();
  const words = trimmed.split(/\s+/).length;
  const symbols = (trimmed.match(/[^\w\s]/g) ?? []).length;
  const approxChars = trimmed.length;
  const perToken = approxChars > 0 && approxChars / Math.max(1, words) > 12 ? 5 : 4;
  const tokens = Math.ceil(approxChars / perToken) + Math.ceil(symbols / 3);
  return Math.max(1, tokens);
}

export function estimateMessageTokens(m: ChatMessage): number {
  let text = "";
  if (typeof m.content === "string") text = m.content;
  else if (Array.isArray(m.content)) {
    for (const part of m.content) {
      if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
        text += part.text;
      }
    }
  }
  let extra = 0;
  if (m.name) extra += estimateTokens(m.name);
  if (m.tool_calls) extra += 12;
  if (m.tool_call_id) extra += 8;
  return estimateTokens(text) + 4 /* per-message overhead */ + extra;
}

export function estimatePromptTokens(messages: ChatMessage[]): number {
  return messages.reduce((acc, m) => acc + estimateMessageTokens(m), 0);
}
