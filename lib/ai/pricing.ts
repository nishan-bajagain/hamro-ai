import type { ProviderId } from "@/lib/config";

/**
 * Pricing table in USD per 1,000,000 tokens (input / output).
 * Keyed by the provider-prefixed canonical id, e.g. "groq/llama-3.3-70b-versatile".
 * Provider wildcards ("ollama/*") cover free tiers; any model missing from the
 * table falls back to the default rate.
 */
export const PRICING: Record<string, { input: number; output: number }> = {
  // Groq
  "groq/llama-3.3-70b-versatile": { input: 0.59, output: 0.79 },
  "groq/llama-3.3-70b-specdec": { input: 0.59, output: 0.79 },
  "groq/llama-3.1-8b-instant": { input: 0.05, output: 0.08 },
  "groq/llama-3.3-90b-vision-preview": { input: 0.9, output: 0.9 },

  // OpenRouter (free tier)
  "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free": { input: 0, output: 0 },
  "openrouter/nvidia/nemotron-3-super-120b-a12b:free": { input: 0, output: 0 },
  "openrouter/openrouter/free": { input: 0, output: 0 },

  // OpenCode Zen
  "opencode/nemotron-3-ultra-free": { input: 0, output: 0 },
  "opencode/deepseek-v4-flash-free": { input: 0, output: 0 },
  "opencode/deepseek-v4-flash": { input: 0.14, output: 0.28 },
  "opencode/deepseek-v4-pro": { input: 1.74, output: 3.48 },

  // Free-tier providers — everything is free unless overridden above.
  "ollama/*": { input: 0, output: 0 },
  "naga/*": { input: 0, output: 0 },
  "zenmux/*": { input: 0, output: 0 },
  "llm7/*": { input: 0, output: 0 },
  "cerebras/*": { input: 0, output: 0 },
  "chutes/*": { input: 0, output: 0 },
  "huggingface/*": { input: 0, output: 0 },

  // Sensible default for anything else
  "*": { input: 1.0, output: 3.0 },
};

export function pricingFor(provider: ProviderId, model: string) {
  const canonical = `${provider}/${model}`;
  return (
    PRICING[canonical] ?? PRICING[`${provider}/*`] ?? PRICING["*"]
  );
}

/** USD cost for a request, given token counts. */
export function estimateCost(
  provider: ProviderId,
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const p = pricingFor(provider, model);
  return (promptTokens / 1_000_000) * p.input + (completionTokens / 1_000_000) * p.output;
}
