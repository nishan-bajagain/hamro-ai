# hamro.site — Free AI Gateway

A high-performance, **open-access AI Gateway** built with Next.js (App Router) + TypeScript.
It exposes a single **OpenAI-compatible REST API** (`/v1/*`) that aggregates multiple LLM
providers (Groq, OpenRouter, OpenCode Zen) behind one public API key, with smart routing,
automatic failover, streaming, token accounting and a live status dashboard — free for
coding agents like Claude Code, Cursor, Aider and custom CLI extensions.

> **📖 Full documentation** — API reference, free-access guide, and step-by-step setup
> for Claude Code, Cursor, Aider and other agents: **[DOCS.md](DOCS.md)**.

## Highlights

- **One key, many models** — `Authorization: Bearer nishan-bajagain` unlocks every model.
- **OpenAI-compatible** — `POST /v1/chat/completions` (streaming + JSON) and `GET /v1/models`.
- **Smart routing** — sticky-success: providers that recently succeeded are prioritized;
  providers that just failed are pushed to the back of the chain for a 30s cooldown.
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

| Provider   | Model                                  | Pricing      |
| ---------- | -------------------------------------- | ------------ |
| Groq       | `llama-3.3-70b-versatile`              | $0.59 / $0.79 per 1M |
| OpenRouter | `nvidia/nemotron-3-ultra-550b-a55b:free` | free       |
| OpenRouter | `openrouter/free` (auto-routes best free) | free    |
| OpenCode   | `nemotron-3-ultra-free`                | free         |
| OpenCode   | `deepseek-v4-flash-free`               | free         |

Model ids are provider-prefixed (`groq/…`, `openrouter/…`, `opencode/…`) so routing is
unambiguous. You may also pass the bare model id (`llama-3.3-70b-versatile`) — it is
resolved against the catalog.

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

MODEL_FALLBACK_CHAIN="groq/llama-3.3-70b-versatile,openrouter/nvidia/nemotron-3-ultra-550b-a55b:free,openrouter/openrouter/free,opencode/nemotron-3-ultra-free,opencode/deepseek-v4-flash-free"
```

Optional: `GROQ_MODELS`, `OPENROUTER_MODELS`, `OPENCODE_MODELS` (comma-separated) override
the per-provider model catalog. `NEXT_PUBLIC_PUBLIC_API_KEY` can override the key the
built-in playground uses in the browser. Set `DATA_FILE` to an absolute writable path if
you want telemetry persisted somewhere other than `./data.json` (e.g. a volume on
serverless).

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
- More providers (together.ai, Mistral, local Ollama) via the same catalog
