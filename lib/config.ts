/**
 * Central configuration. Reads provider keys, model catalogs and the
 * fallback chain from environment variables (see .env.example).
 */

export type ProviderId = "groq" | "openrouter" | "opencode";

export const PROVIDER_IDS: ProviderId[] = ["groq", "openrouter", "opencode"];

export interface CatalogModel {
  /** Model id as expected by the provider API. */
  id: string;
  /** Human friendly display name. */
  name: string;
  /** Context window in tokens (best effort). */
  context: number;
  /** USD per 1M input tokens. */
  inputPrice: number;
  /** USD per 1M output tokens. */
  outputPrice: number;
}

export interface ProviderConfig {
  id: ProviderId;
  label: string;
  /** OpenAI-compatible base url, including the /v1 suffix. */
  baseUrl: string;
  apiKey: string;
  models: CatalogModel[];
  homeUrl: string;
}

/* ─────────────────────────────── Catalogs ─────────────────────────── */

const GROQ_DEFAULT_MODELS: CatalogModel[] = [
  {
    id: "llama-3.3-70b-versatile",
    name: "Llama 3.3 70B Versatile",
    context: 131072,
    inputPrice: 0.59,
    outputPrice: 0.79,
  },
];

const OPENROUTER_DEFAULT_MODELS: CatalogModel[] = [
  {
    id: "nvidia/nemotron-3-ultra-550b-a55b:free",
    name: "Nemotron 3 Ultra 550B (free)",
    context: 1000000,
    inputPrice: 0,
    outputPrice: 0,
  },
  {
    id: "openrouter/free",
    name: "OpenRouter Free (auto-routes best free model)",
    context: 200000,
    inputPrice: 0,
    outputPrice: 0,
  },
];

const OPENCODE_DEFAULT_MODELS: CatalogModel[] = [
  {
    id: "nemotron-3-ultra-free",
    name: "Nemotron 3 Ultra Free",
    context: 131072,
    inputPrice: 0,
    outputPrice: 0,
  },
  {
    id: "deepseek-v4-flash-free",
    name: "DeepSeek V4 Flash Free",
    context: 131072,
    inputPrice: 0,
    outputPrice: 0,
  },
];

/* ──────────────────────────── Helpers ─────────────────────────────── */

function csv(value: string | undefined): string[] | null {
  if (!value) return null;
  const parts = value
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length ? parts : null;
}

function pickModels(defaults: CatalogModel[], envKey: string): CatalogModel[] {
  const ids = csv(process.env[envKey]);
  if (!ids) return defaults;
  return ids.map((id) => {
    const known = defaults.find((m) => m.id === id);
    return (
      known ?? {
        id,
        name: id,
        context: 131072,
        inputPrice: 0,
        outputPrice: 0,
      }
    );
  });
}

/* ─────────────────────────── Build config ─────────────────────────── */

function buildProviders(): ProviderConfig[] {
  const providers: ProviderConfig[] = [
    {
      id: "groq",
      label: "Groq",
      baseUrl: process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1",
      apiKey: process.env.GROQ_API_KEY ?? "",
      models: pickModels(GROQ_DEFAULT_MODELS, "GROQ_MODELS"),
      homeUrl: "https://groq.com",
    },
    {
      id: "openrouter",
      label: "OpenRouter",
      baseUrl:
        process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY ?? "",
      models: pickModels(OPENROUTER_DEFAULT_MODELS, "OPENROUTER_MODELS"),
      homeUrl: "https://openrouter.ai",
    },
    {
      id: "opencode",
      label: "OpenCode Zen",
      baseUrl:
        process.env.OPENCODE_BASE_URL ?? "https://opencode.ai/zen/v1",
      apiKey: process.env.OPENCODE_API_KEY ?? "",
      models: pickModels(OPENCODE_DEFAULT_MODELS, "OPENCODE_MODELS"),
      homeUrl: "https://opencode.ai",
    },
  ];
  return providers.filter((p) => p.models.length > 0);
}

export const PROVIDERS: ProviderConfig[] = buildProviders();

export function getProvider(id: ProviderId): ProviderConfig | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export function getConfiguredProviders(): ProviderConfig[] {
  return PROVIDERS.filter((p) => p.apiKey.length > 0);
}

export const PUBLIC_API_KEY: string =
  process.env.PUBLIC_API_KEY || "nishan-bajagain";

export const SITE_NAME = "hamro.site";

/** Resolve "provider/model" entries from MODEL_FALLBACK_CHAIN. */
export function parseFallbackChain(): { provider: ProviderId; model: string }[] {
  const raw = process.env.MODEL_FALLBACK_CHAIN;
  const defaults = [
    { provider: "groq" as ProviderId, model: "llama-3.3-70b-versatile" },
    {
      provider: "openrouter" as ProviderId,
      model: "nvidia/nemotron-3-ultra-550b-a55b:free",
    },
    { provider: "openrouter" as ProviderId, model: "openrouter/free" },
    { provider: "opencode" as ProviderId, model: "nemotron-3-ultra-free" },
    { provider: "opencode" as ProviderId, model: "deepseek-v4-flash-free" },
  ];
  if (!raw) return defaults;
  const entries = raw
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean)
    .map((e) => {
      const slash = e.indexOf("/");
      if (slash === -1) return null;
      const provider = e.slice(0, slash) as ProviderId;
      const model = e.slice(slash + 1);
      return PROVIDERS.some((p) => p.id === provider) && model
        ? { provider, model }
        : null;
    })
    .filter((e): e is { provider: ProviderId; model: string } => e !== null);
  return entries.length ? entries : defaults;
}

/** Canonical "provider/model" id used in /v1/models and the UI. */
export function canonicalModelId(provider: ProviderId, model: string): string {
  return `${provider}/${model}`;
}
