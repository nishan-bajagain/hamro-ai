# hamro.site — Free AI Gateway

A high-performance, **open-access AI Gateway** built with Next.js (App Router) + TypeScript.
It exposes a single **OpenAI-compatible REST API** (`/v1/*`) that aggregates ten LLM
providers (Groq, OpenRouter, OpenCode Zen, Ollama Cloud, Naga AI, ZenMux, LLM7,
Cerebras, Chutes and HuggingFace) behind one public API key, with smart routing,
automatic failover, streaming, token accounting and a live status dashboard — free for
coding agents like Claude Code, Cursor, Aider and custom CLI extensions.

> **📖 Full documentation** — API reference, free-access guide, and step-by-step setup
> for Claude Code, Cursor, Aider and other agents: **[DOCS.md](DOCS.md)**.

## Highlights

- **One key, many models** — `Authorization: Bearer nishan-bajagain` unlocks every model.
- **OpenAI-compatible** — `POST /v1/chat/completions` (streaming + JSON) and `GET /v1/models`.
- **Smart routing** — sticky-success: providers that recently succeeded are prioritized;
  providers that just failed are pushed to the back of the chain for a 30s cooldown.
- **Random model mode** — request `model: "random"` and the gateway picks a random
  configured model and pins it to your session: it keeps serving that exact model
  until you disconnect (or the session idles out) or the model errors — it never
  switches mid-session on its own.
- **Automatic failover** — on 401/403/404/429/5xx, timeouts and network errors the router
  walks the `MODEL_FALLBACK_CHAIN`; streaming requests fail over *before the first chunk*,
  so the client connection never breaks.
- **Agent-tuned streaming** — SSE chunks, `tool_calls` deltas and reasoning content pass
  through verbatim (only the `model` field is rewritten); `stream_options.include_usage`
  is requested where supported.
- **Telemetry, no database** — every call is logged (tokens, cost from standard pricing
  tables, latency, TTFT, failovers, client) to a plain **`data.json`** file and shown on
  `/status`. Works on serverless hosts too (auto in-memory fallback).
- **Docs site** — a full in-app documentation page at `/docs` (API reference, free-access
  guide, agent setup) with sidebar TOC and copyable code blocks.
- **Rate limiting + caching** — per-key sliding-window rate limits (`429` + `Retry-After`)
  and an in-memory cache for deterministic requests (`x-gateway-cache: HIT`).
- **Adaptive failover** — exponential provider cooldowns, latency-aware chain ordering
  (fastest provider first) and adaptive first-chunk timeouts.
- **Playground** — a streaming chat UI (`/chat`) with model selector, system-prompt editor,
  code highlighting, TTFT/latency readouts and copyable code blocks.

## Models configured

| Provider   | Model(s)                              | Pricing |
| ---------- | ------------------------------------- | ------- |
| Groq       | `llama-3.3-70b-versatile`             | $0.59 / $0.79 per 1M |
| OpenRouter | `nvidia/nemotron-3-ultra-550b-a55b:free`, `nvidia/nemotron-3-super-120b-a12b:free`, `openrouter/free` | free |
| OpenCode   | `nemotron-3-ultra-free`, `deepseek-v4-flash-free` | free |
| Ollama Cloud | `nemotron-3-ultra`, `nemotron-3-super`, `gpt-oss:120b`, `gemma4:31b` | free |
| Naga AI    | `nemotron-3-ultra-550b-a55b:free`, `nemotron-3-super-120b-a12b:free`, `llama-3.3-70b-instruct:free`, `llama-4-scout-17b-16e-instruct:free` | free |
| ZenMux     | `deepseek/deepseek-v4-flash-free`, `z-ai/glm-4.7-flash-free`, `z-ai/glm-4.6v-flash-free` | free |
| LLM7       | `gpt-oss:20b`, `gemma4:31b`, `minimax-m2.7`, `codestral-latest`, `mistral-Nemo-Instruct-2407` | free |
| Cerebras   | `zai-glm-4.7`, `gpt-oss-120b`, `gemma-4-31b` | free |
| Chutes     | `deepseek-ai/DeepSeek-V4-Flash-0731-TEE`, `Qwen/Qwen3-235B-A22B-Thinking-2507-TEE`, `zai-org/GLM-5.2-TEE`, `moonshotai/Kimi-K2.6-TEE`, and more | free |
| HuggingFace| `meta-llama/Llama-3.3-70B-Instruct`, `deepseek-ai/DeepSeek-V4-Flash`, `zai-org/GLM-5.2`, `moonshotai/Kimi-K3`, `Qwen/Qwen3-Coder-480B-A35B-Instruct`, and more | free |

There is also a virtual **`random`** model — the gateway picks one of the above at
random per session (see Highlights). Model ids are provider-prefixed
(`groq/…`, `ollama/…`, `huggingface/…`) so routing is unambiguous. You may also pass
the bare model id (`llama-3.3-70b-versatile`) — it is resolved against the catalog.

## Getting started

```bash
npm install
npm run dev             # http://localhost:3000
```

No database to set up — telemetry is saved to `data.json` automatically.

### Environment variables

Copy `.env.example` to `.env` and fill in your keys:

```env
PUBLIC_API_KEY="nishan-bajagain"

GROQ_API_KEY="gsk_..."
OPENROUTER_API_KEY="sk-or-..."
OPENCODE_API_KEY="sk-..."
OPENCODE_BASE_URL="https://opencode.ai/zen/v1"

OLLAMA_API_KEY="..."            # Ollama Cloud
NAGA_API_KEY="ng-..."           # Naga AI
ZENMUX_API_KEY="sk-mg-v1-..."   # ZenMux
LLM7_API_KEY="..."              # LLM7
CEREBRAS_API_KEY="csk-..."      # Cerebras
CHUTES_API_KEY="cpk_..."        # Chutes
HUGGINGFACE_API_KEY="hf_..."    # HuggingFace router

MODEL_FALLBACK_CHAIN="groq/llama-3.3-70b-versatile,ollama/nemotron-3-ultra,naga/nemotron-3-ultra-550b-a55b:free,llm7/gpt-oss:20b,huggingface/meta-llama/Llama-3.3-70B-Instruct,openrouter/nvidia/nemotron-3-ultra-550b-a55b:free,zenmux/deepseek/deepseek-v4-flash-free,cerebras/zai-glm-4.7,chutes/deepseek-ai/DeepSeek-V4-Flash-0731-TEE,opencode/nemotron-3-ultra-free,opencode/deepseek-v4-flash-free"
```

Every provider accepts an optional `<PROVIDER>_BASE_URL` override and a
`<PROVIDER>_MODELS` comma-separated model-list override (e.g. `OLLAMA_MODELS`).
`NEXT_PUBLIC_PUBLIC_API_KEY` can override the key the built-in playground uses in the
browser. Set `DATA_FILE` to an absolute writable path if you want telemetry persisted
somewhere other than `./data.json`. On serverless hosts (e.g. Vercel) set
`KV_REST_API_URL` + `KV_REST_API_TOKEN` from a free Vercel KV / Upstash store so
`/status` telemetry survives cold starts (file storage there is ephemeral).
`RANDOM_SESSION_TTL_SECONDS` (default 3600) controls
how long a session keeps its randomly-picked model after last use.

## Using it with coding agents

Set the base URL + key in any OpenAI-compatible client:

```bash
export OPENAI_API_KEY="nishan-bajagain"
export OPENAI_BASE_URL="https://hamro.site/v1"
```

| Agent | Notes |
| --- | --- |
| **Cursor, Aider, OpenCode, Continue, Cline, Roo, Windsurf, Zed** | Work directly (OpenAI format) — see [DOCS.md](DOCS.md) |
| **Claude Code** | Needs Anthropic protocol → use Claude Code Router (CCR) in front of this gateway — see [DOCS.md](DOCS.md) |

Or plain curl:

```bash
curl https://hamro.site/v1/chat/completions \
  -H "Authorization: Bearer nishan-bajagain" \
  -H "Content-Type: application/json" \
  -d '{"model":"groq/llama-3.3-70b-versatile","messages":[{"role":"user","content":"hi"}],"stream":true}'
```

## API reference

### `POST /v1/chat/completions`

OpenAI-compatible. Supports `stream: true` (SSE) and standard JSON, plus
`temperature`, `max_tokens`, `top_p`, `stop`, `tools`, `tool_choice`,
`response_format`, `stream_options`, etc.

Response headers expose routing info: `x-gateway-provider`, `x-gateway-model`,
`x-gateway-failovers`.

### `GET /v1/models`

Lists configured, operational models with `owned_by`, `context_length` and `pricing`.

### Errors

- `401` — missing/wrong `Authorization` header
- `404` — unknown model
- `429` / `502` — all providers failed (last upstream error is returned in OpenAI format)
- Mid-stream failures emit an SSE `data: {"error": …}` event followed by `[DONE]`

## Architecture

```
app/
  v1/chat/completions/route.ts   proxy route: auth → validate → route (stream/JSON)
  v1/models/route.ts             model list
  status/page.tsx + /chat/page.tsx
  api/status/route.ts            public telemetry (dashboard polling)
  api/healthcheck/route.ts       provider pings (online/degraded/offline)
lib/
  ai/router.ts                   sticky failover, chain resolution, streaming pump
  ai/providers.ts                fetch layer, error parsing, SSE parser
  ai/pricing.ts                  per-model $/1M tables + cost estimation
  ai/tokens.ts                   char-based token estimation
  db/store.ts                    JSON-file telemetry store (data.json, in-memory fallback)
  db/log.ts                      request + provider-status logging helpers
  auth.ts                        timing-safe bearer validation + client detection
```

### Routing algorithm

1. Resolve the requested model → candidate list `[requested] + MODEL_FALLBACK_CHAIN`
   (deduped, configured providers only).
2. Reorder: sticky-cooldown providers move to the back.
3. For each candidate: call the provider; on failure (or no first chunk within 20s)
   log it, mark sticky failure, and try the next.
4. Commit to the first provider that produces a chunk; stream everything through,
   accumulate tokens, then log usage/cost at completion.

## Security notes

- The gateway is intentionally **open-access** (public shared key) — treat it as a
  community service. If you deploy it publicly, consider rate limiting or per-user keys.
- Provider keys live only in `.env` (gitignored). **If you have ever pasted a provider
  key into a public chat, rotate it** — assume it is compromised.
- All `/v1/*` routes require the bearer token; comparison is timing-safe.

## Roadmap ideas

- Per-user API keys + usage quotas
- Redis/Postgres-backed sticky state for multi-instance deploys
- Prompt caching / context compaction for agents
- More providers (together.ai, Mistral, etc.) via the same catalog
