/**
 * Central configuration. Reads provider keys, model catalogs and the
 * fallback chain from environment variables (see .env.example).
 */

export type ProviderId =
  | "groq"
  | "openrouter"
  | "opencode"
  | "ollama"
  | "naga"
  | "zenmux"
  | "llm7"
  | "cerebras"
  | "chutes"
  | "huggingface"
  | "mistral"
  | "zai";

export const PROVIDER_IDS: ProviderId[] = [
  "groq",
  "openrouter",
  "opencode",
  "ollama",
  "naga",
  "zenmux",
  "llm7",
  "cerebras",
  "chutes",
  "huggingface",
  "mistral",
  "zai",
];

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
    id: "nvidia/nemotron-3-super-120b-a12b:free",
    name: "Nemotron 3 Super 120B (free)",
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

/** Ollama Cloud — free models verified against the account key. */
const OLLAMA_DEFAULT_MODELS: CatalogModel[] = [
  {
    id: "nemotron-3-ultra",
    name: "Nemotron 3 Ultra (Ollama Cloud, free)",
    context: 262144,
    inputPrice: 0,
    outputPrice: 0,
  },
  {
    id: "nemotron-3-super",
    name: "Nemotron 3 Super (Ollama Cloud, free)",
    context: 262144,
    inputPrice: 0,
    outputPrice: 0,
  },
  {
    id: "gpt-oss:120b",
    name: "GPT-OSS 120B (Ollama Cloud, free)",
    context: 131072,
    inputPrice: 0,
    outputPrice: 0,
  },
  {
    id: "gemma4:31b",
    name: "Gemma 4 31B (Ollama Cloud, free)",
    context: 262144,
    inputPrice: 0,
    outputPrice: 0,
  },
];

/** Naga AI — OpenRouter-compatible, free `:free` models. */
const NAGA_DEFAULT_MODELS: CatalogModel[] = [
  {
    id: "nemotron-3-ultra-550b-a55b:free",
    name: "Nemotron 3 Ultra 550B (Naga, free)",
    context: 1000000,
    inputPrice: 0,
    outputPrice: 0,
  },
  {
    id: "nemotron-3-super-120b-a12b:free",
    name: "Nemotron 3 Super 120B (Naga, free)",
    context: 1000000,
    inputPrice: 0,
    outputPrice: 0,
  },
  {
    id: "llama-3.3-70b-instruct:free",
    name: "Llama 3.3 70B Instruct (Naga, free)",
    context: 131072,
    inputPrice: 0,
    outputPrice: 0,
  },
  {
    id: "llama-4-scout-17b-16e-instruct:free",
    name: "Llama 4 Scout 17B (Naga, free)",
    context: 1000000,
    inputPrice: 0,
    outputPrice: 0,
  },
];

/** ZenMux — free models (`-free` suffix). */
const ZENMUX_DEFAULT_MODELS: CatalogModel[] = [
  {
    id: "deepseek/deepseek-v4-flash-free",
    name: "DeepSeek V4 Flash (ZenMux, free)",
    context: 131072,
    inputPrice: 0,
    outputPrice: 0,
  },
  {
    id: "z-ai/glm-4.7-flash-free",
    name: "GLM 4.7 Flash (ZenMux, free)",
    context: 131072,
    inputPrice: 0,
    outputPrice: 0,
  },
  {
    id: "z-ai/glm-4.6v-flash-free",
    name: "GLM 4.6V Flash (ZenMux, free)",
    context: 131072,
    inputPrice: 0,
    outputPrice: 0,
  },
];

/** LLM7 — free "turbo" tier models. */
const LLM7_DEFAULT_MODELS: CatalogModel[] = [
  {
    id: "gpt-oss:20b",
    name: "GPT-OSS 20B (LLM7, free)",
    context: 128000,
    inputPrice: 0,
    outputPrice: 0,
  },
  {
    id: "gemma4:31b",
    name: "Gemma 4 31B (LLM7, free)",
    context: 262000,
    inputPrice: 0,
    outputPrice: 0,
  },
  {
    id: "minimax-m2.7",
    name: "MiniMax M2.7 (LLM7, free)",
    context: 180000,
    inputPrice: 0,
    outputPrice: 0,
  },
  {
    id: "codestral-latest",
    name: "Codestral Latest (LLM7, free)",
    context: 32000,
    inputPrice: 0,
    outputPrice: 0,
  },
  {
    id: "mistral-Nemo-Instruct-2407",
    name: "Mistral Nemo 12B (LLM7, free)",
    context: 128000,
    inputPrice: 0,
    outputPrice: 0,
  },
];

/** Cerebras — models exposed to this key (free-tier). */
const CEREBRAS_DEFAULT_MODELS: CatalogModel[] = [
  {
    id: "zai-glm-4.7",
    name: "Z.ai GLM 4.7 (Cerebras)",
    context: 131072,
    inputPrice: 0,
    outputPrice: 0,
  },
  {
    id: "gpt-oss-120b",
    name: "GPT-OSS 120B (Cerebras)",
    context: 131072,
    inputPrice: 0,
    outputPrice: 0,
  },
  {
    id: "gemma-4-31b",
    name: "Gemma 4 31B (Cerebras)",
    context: 131072,
    inputPrice: 0,
    outputPrice: 0,
  },
];

/** Chutes AI — TEE-hosted open models. */
const CHUTES_DEFAULT_MODELS: CatalogModel[] = [
  {
    id: "deepseek-ai/DeepSeek-V4-Flash-0731-TEE",
    name: "DeepSeek V4 Flash (Chutes)",
    context: 131072,
    inputPrice: 0,
    outputPrice: 0,
  },
  {
    id: "Qwen/Qwen3-235B-A22B-Thinking-2507-TEE",
    name: "Qwen3 235B Thinking (Chutes)",
    context: 262144,
    inputPrice: 0,
    outputPrice: 0,
  },
  {
    id: "zai-org/GLM-5.2-TEE",
    name: "GLM 5.2 (Chutes)",
    context: 262144,
    inputPrice: 0,
    outputPrice: 0,
  },
  {
    id: "moonshotai/Kimi-K2.6-TEE",
    name: "Kimi K2.6 (Chutes)",
    context: 262144,
    inputPrice: 0,
    outputPrice: 0,
  },
  {
    id: "Qwen/Qwen3.6-27B-TEE",
    name: "Qwen3.6 27B (Chutes)",
    context: 262144,
    inputPrice: 0,
    outputPrice: 0,
  },
  {
    id: "google/gemma-4-31B-turbo-TEE",
    name: "Gemma 4 31B Turbo (Chutes)",
    context: 262144,
    inputPrice: 0,
    outputPrice: 0,
  },
  {
    id: "Nemotron-3-Nano-Omni-30B-TEE",
    name: "Nemotron 3 Nano Omni 30B (Chutes)",
    context: 131072,
    inputPrice: 0,
    outputPrice: 0,
  },
];

/** HuggingFace Inference Providers router — free chat models. */
const HUGGINGFACE_DEFAULT_MODELS: CatalogModel[] = [
  {
    id: "meta-llama/Llama-3.3-70B-Instruct",
    name: "Llama 3.3 70B Instruct (HF)",
    context: 131072,
    inputPrice: 0,
    outputPrice: 0,
  },
  {
    id: "deepseek-ai/DeepSeek-V4-Flash-0731",
    name: "DeepSeek V4 Flash (HF)",
    context: 1048576,
    inputPrice: 0,
    outputPrice: 0,
  },
  {
    id: "deepseek-ai/DeepSeek-V4-Flash",
    name: "DeepSeek V4 Flash (HF, latest)",
    context: 1048576,
    inputPrice: 0,
    outputPrice: 0,
  },
  {
    id: "deepseek-ai/DeepSeek-R1",
    name: "DeepSeek R1 (HF)",
    context: 64000,
    inputPrice: 0,
    outputPrice: 0,
  },
  {
    id: "deepseek-ai/DeepSeek-V3.2",
    name: "DeepSeek V3.2 (HF)",
    context: 163840,
    inputPrice: 0,
    outputPrice: 0,
  },
  {
    id: "Qwen/Qwen3-235B-A22B-Instruct-2507",
    name: "Qwen3 235B Instruct (HF)",
    context: 262144,
    inputPrice: 0,
    outputPrice: 0,
  },
  {
    id: "Qwen/Qwen3-235B-A22B-Thinking-2507",
    name: "Qwen3 235B Thinking (HF)",
    context: 262144,
    inputPrice: 0,
    outputPrice: 0,
  },
  {
    id: "Qwen/Qwen3-Coder-480B-A35B-Instruct",
    name: "Qwen3 Coder 480B (HF)",
    context: 262144,
    inputPrice: 0,
    outputPrice: 0,
  },
  {
    id: "Qwen/Qwen3-Coder-Next",
    name: "Qwen3 Coder Next (HF)",
    context: 262144,
    inputPrice: 0,
    outputPrice: 0,
  },
  {
    id: "Qwen/Qwen3.5-397B-A17B",
    name: "Qwen3.5 397B (HF)",
    context: 262144,
    inputPrice: 0,
    outputPrice: 0,
  },
  {
    id: "Qwen/Qwen2.5-Coder-32B-Instruct",
    name: "Qwen2.5 Coder 32B (HF)",
    context: 131072,
    inputPrice: 0,
    outputPrice: 0,
  },
  {
    id: "nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-BF16",
    name: "Nemotron 3 Ultra 550B (HF)",
    context: 262144,
    inputPrice: 0,
    outputPrice: 0,
  },
  {
    id: "zai-org/GLM-5.2",
    name: "GLM 5.2 (HF)",
    context: 1048576,
    inputPrice: 0,
    outputPrice: 0,
  },
  {
    id: "zai-org/GLM-4.7-Flash",
    name: "GLM 4.7 Flash (HF)",
    context: 202752,
    inputPrice: 0,
    outputPrice: 0,
  },
  {
    id: "zai-org/GLM-4.6V-Flash",
    name: "GLM 4.6V Flash (HF)",
    context: 131072,
    inputPrice: 0,
    outputPrice: 0,
  },
  {
    id: "moonshotai/Kimi-K3",
    name: "Kimi K3 (HF)",
    context: 1048576,
    inputPrice: 0,
    outputPrice: 0,
  },
  {
    id: "moonshotai/Kimi-K2.7-Code",
    name: "Kimi K2.7 Code (HF)",
    context: 262144,
    inputPrice: 0,
    outputPrice: 0,
  },
  {
    id: "MiniMaxAI/MiniMax-M3",
    name: "MiniMax M3 (HF)",
    context: 1000000,
    inputPrice: 0,
    outputPrice: 0,
  },
  {
    id: "google/gemma-4-31B-it",
    name: "Gemma 4 31B (HF)",
    context: 262144,
    inputPrice: 0,
    outputPrice: 0,
  },
  {
    id: "thinkingmachines/Inkling",
    name: "Inkling (HF)",
    context: 1048576,
    inputPrice: 0,
    outputPrice: 0,
  },
  {
    id: "stepfun-ai/Step-3.7-Flash",
    name: "Step 3.7 Flash (HF)",
    context: 262144,
    inputPrice: 0,
    outputPrice: 0,
  },
  {
    id: "XiaomiMiMo/MiMo-V2.5",
    name: "MiMo V2.5 (HF)",
    context: 262144,
    inputPrice: 0,
    outputPrice: 0,
  },
];

/** Mistral — free-tier chat models verified against the account key. */
const MISTRAL_DEFAULT_MODELS: CatalogModel[] = [
  {
    id: "mistral-small-latest",
    name: "Mistral Small (free)",
    context: 32768,
    inputPrice: 0,
    outputPrice: 0,
  },
  {
    id: "ministral-3b-latest",
    name: "Ministral 3B (free)",
    context: 131072,
    inputPrice: 0,
    outputPrice: 0,
  },
  {
    id: "ministral-8b-latest",
    name: "Ministral 8B (free)",
    context: 131072,
    inputPrice: 0,
    outputPrice: 0,
  },
  {
    id: "codestral-latest",
    name: "Codestral (free, coding)",
    context: 32768,
    inputPrice: 0,
    outputPrice: 0,
  },
  {
    id: "open-mistral-7b",
    name: "Open Mistral 7B (free)",
    context: 32768,
    inputPrice: 0,
    outputPrice: 0,
  },
  {
    id: "open-mixtral-8x7b",
    name: "Open Mixtral 8x7B (free)",
    context: 32768,
    inputPrice: 0,
    outputPrice: 0,
  },
];

/** Z.ai (GLM) — free model verified against the account key (others need balance). */
const ZAI_DEFAULT_MODELS: CatalogModel[] = [
  {
    id: "glm-4.5-flash",
    name: "GLM 4.5 Flash (free)",
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
    {
      id: "ollama",
      label: "Ollama Cloud",
      baseUrl: process.env.OLLAMA_BASE_URL ?? "https://ollama.com/v1",
      apiKey: process.env.OLLAMA_API_KEY ?? "",
      models: pickModels(OLLAMA_DEFAULT_MODELS, "OLLAMA_MODELS"),
      homeUrl: "https://ollama.com",
    },
    {
      id: "naga",
      label: "Naga AI",
      baseUrl: process.env.NAGA_BASE_URL ?? "https://api.naga.ac/v1",
      apiKey: process.env.NAGA_API_KEY ?? "",
      models: pickModels(NAGA_DEFAULT_MODELS, "NAGA_MODELS"),
      homeUrl: "https://naga.ac",
    },
    {
      id: "zenmux",
      label: "ZenMux",
      baseUrl: process.env.ZENMUX_BASE_URL ?? "https://zenmux.ai/api/v1",
      apiKey: process.env.ZENMUX_API_KEY ?? "",
      models: pickModels(ZENMUX_DEFAULT_MODELS, "ZENMUX_MODELS"),
      homeUrl: "https://zenmux.ai",
    },
    {
      id: "llm7",
      label: "LLM7",
      baseUrl: process.env.LLM7_BASE_URL ?? "https://api.llm7.io/v1",
      apiKey: process.env.LLM7_API_KEY ?? "",
      models: pickModels(LLM7_DEFAULT_MODELS, "LLM7_MODELS"),
      homeUrl: "https://llm7.io",
    },
    {
      id: "cerebras",
      label: "Cerebras",
      baseUrl: process.env.CEREBRAS_BASE_URL ?? "https://api.cerebras.ai/v1",
      apiKey: process.env.CEREBRAS_API_KEY ?? "",
      models: pickModels(CEREBRAS_DEFAULT_MODELS, "CEREBRAS_MODELS"),
      homeUrl: "https://cerebras.ai",
    },
    {
      id: "chutes",
      label: "Chutes AI",
      baseUrl: process.env.CHUTES_BASE_URL ?? "https://llm.chutes.ai/v1",
      apiKey: process.env.CHUTES_API_KEY ?? "",
      models: pickModels(CHUTES_DEFAULT_MODELS, "CHUTES_MODELS"),
      homeUrl: "https://chutes.ai",
    },
    {
      id: "huggingface",
      label: "HuggingFace",
      baseUrl:
        process.env.HUGGINGFACE_BASE_URL ?? "https://router.huggingface.co/v1",
      apiKey: process.env.HUGGINGFACE_API_KEY ?? "",
      models: pickModels(HUGGINGFACE_DEFAULT_MODELS, "HUGGINGFACE_MODELS"),
      homeUrl: "https://huggingface.co",
    },
    {
      id: "mistral",
      label: "Mistral AI",
      baseUrl: process.env.MISTRAL_BASE_URL ?? "https://api.mistral.ai/v1",
      apiKey: process.env.MISTRAL_API_KEY ?? "",
      models: pickModels(MISTRAL_DEFAULT_MODELS, "MISTRAL_MODELS"),
      homeUrl: "https://mistral.ai",
    },
    {
      id: "zai",
      label: "Z.ai (GLM)",
      baseUrl: process.env.ZAI_BASE_URL ?? "https://api.z.ai/api/paas/v4",
      apiKey: process.env.ZAI_API_KEY ?? "",
      models: pickModels(ZAI_DEFAULT_MODELS, "ZAI_MODELS"),
      homeUrl: "https://z.ai",
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
    { provider: "ollama" as ProviderId, model: "nemotron-3-ultra" },
    {
      provider: "naga" as ProviderId,
      model: "nemotron-3-ultra-550b-a55b:free",
    },
    { provider: "llm7" as ProviderId, model: "gpt-oss:20b" },
    {
      provider: "huggingface" as ProviderId,
      model: "meta-llama/Llama-3.3-70B-Instruct",
    },
    {
      provider: "openrouter" as ProviderId,
      model: "nvidia/nemotron-3-ultra-550b-a55b:free",
    },
    {
      provider: "zenmux" as ProviderId,
      model: "deepseek/deepseek-v4-flash-free",
    },
    { provider: "cerebras" as ProviderId, model: "zai-glm-4.7" },
    {
      provider: "chutes" as ProviderId,
      model: "deepseek-ai/DeepSeek-V4-Flash-0731-TEE",
    },
    { provider: "opencode" as ProviderId, model: "nemotron-3-ultra-free" },
    { provider: "opencode" as ProviderId, model: "deepseek-v4-flash-free" },
    { provider: "mistral" as ProviderId, model: "mistral-small-latest" },
    { provider: "zai" as ProviderId, model: "glm-4.5-flash" },
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
