# hamro.site — Free AI Gateway · Full Documentation

A single, OpenAI-compatible API that gives you **free access to multiple frontier
models** through one key and one URL. It aggregates three providers — **Groq**,
**OpenRouter** and **OpenCode Zen** — into a smart routing layer with automatic
failover, so coding agents (Claude Code, Cursor, Aider, OpenCode, custom CLIs)
never see a broken connection.

```
Your agent / script
        │  OpenAI-compatible calls, one key
        ▼
  ┌───────────────────┐
  │  hamro.site       │   /v1/chat/completions, /v1/models
  │  smart router     │   sticky success + auto-failover
  └─────────┬─────────┘
            │
   ┌────────┼────────────┐
   ▼        ▼            ▼
 Groq     OpenRouter  OpenCode Zen
(llama)  (nemotron)  (nemotron, deepseek)
```

---

## Table of contents

1. [The free models](#the-free-models)
2. [Quick start — 2 minutes](#quick-start--2-minutes)
3. [API reference](#api-reference)
   - [Authentication](#authentication)
   - [POST /v1/chat/completions](#post-v1chatcompletions)
   - [Streaming (SSE)](#streaming-sse)
   - [GET /v1/models](#get-v1models)
   - [Response headers](#response-headers)
   - [Errors](#errors)
   - [Failover & routing](#failover--routing)
4. [Using it with coding agents](#using-it-with-coding-agents)
   - [Claude Code](#claude-code)
   - [Cursor](#cursor)
   - [Aider](#aider)
   - [OpenCode / Continue / other agents](#opencode--continue--other-agents)
5. [Getting free API keys](#getting-free-api-keys)
6. [Self-hosting & deployment](#self-hosting--deployment)
7. [Data, telemetry & the status page](#data-telemetry--the-status-page)
8. [Security notes](#security-notes)
9. [Troubleshooting](#troubleshooting)

---

## The free models

All five models are **100% free** (the router also tracks estimated cost for the
paid fallback entries):

| Model id (use this in `model`) | Provider | Context | Notes |
| --- | --- | --- | --- |
| `groq/llama-3.3-70b-versatile` | Groq | 131k | Very fast, great general coding |
| `openrouter/nvidia/nemotron-3-ultra-550b-a55b:free` | OpenRouter | 1M | Nemotron 3 Ultra, free tier |
| `openrouter/openrouter/free` | OpenRouter | 200k | Auto-routes to OpenRouter's best free model |
| `opencode/nemotron-3-ultra-free` | OpenCode Zen | 131k | Nemotron 3 Ultra, free |
| `opencode/deepseek-v4-flash-free` | OpenCode Zen | 131k | DeepSeek V4 Flash, free, shows reasoning |

You can also pass a **bare model id** (`llama-3.3-70b-versatile`) — the router
resolves it against the catalog automatically.

> The canonical id is `provider/model`. Because the OpenRouter model id is
> itself `openrouter/free`, its canonical id is `openrouter/openrouter/free`.

---

## Quick start — 2 minutes

```bash
# 1. Check the models
curl http://localhost:3000/v1/models \
  -H "Authorization: Bearer nishan-bajagain"

# 2. Ask a question (non-streaming)
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer nishan-bajagain" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "groq/llama-3.3-70b-versatile",
    "messages": [{"role": "user", "content": "Explain monads in one sentence."}]
  }'

# 3. Stream a reply
curl -N http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer nishan-bajagain" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "opencode/deepseek-v4-flash-free",
    "messages": [{"role": "user", "content": "Write a bubble sort in Python."}],
    "stream": true
  }'
```

Replace `http://localhost:3000` with your deployed URL when self-hosted.

---

## API reference

### Base URL

| Env | Value |
| --- | --- |
| Local | `http://localhost:3000` |
| Deployed | `https://your-domain.com` |

All endpoints live under `/v1` and speak the **OpenAI API** wire format, so any
client that supports `baseURL` + `apiKey` works as-is.

### Authentication

Every `/v1/*` request **must** include a Bearer token:

```
Authorization: Bearer nishan-bajagain
```

- Missing or wrong key → `401 {"error": {"message": "Invalid API key", ...}}`
- The check is timing-safe and works for browser clients (CORS enabled).
- `GET /v1/models`, `POST /v1/chat/completions` both require it.
- You can change the key in `.env` (`PUBLIC_API_KEY`).

### POST /v1/chat/completions

OpenAI-compatible chat completions with optional streaming.

**Request body** (all standard OpenAI fields are passed through):

```jsonc
{
  "model": "groq/llama-3.3-70b-versatile",   // any model id from /v1/models
  "messages": [
    { "role": "system", "content": "You are a terse coding assistant." },
    { "role": "user", "content": "Refactor this function..." }
  ],
  "stream": false,          // true → SSE events (see below)
  "temperature": 0.3,       // optional
  "max_tokens": 1024,       // optional
  "top_p": 1,               // optional
  "tools": [...],           // optional — tool calling passes through verbatim
  "tool_choice": "auto",
  "stream_options": { "include_usage": true }  // optional — usage in final chunk
}
```

**Non-streaming response** (200):

```jsonc
{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "created": 1754700000,
  "model": "groq/llama-3.3-70b-versatile",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "...",
        "tool_calls": null      // present when the model calls tools
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 25,
    "completion_tokens": 40,
    "total_tokens": 65
  }
}
```

### Streaming (SSE)

Set `"stream": true`. You receive `text/event-stream` chunks:

```
data: {"id":"chatcmpl-...","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}

data: {"id":"chatcmpl-...","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-...","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

- Reasoning models (e.g. DeepSeek) stream their reasoning in `delta.reasoning` /
  `delta.reasoning_content` — pass it through if your client understands it.
- If `stream_options.include_usage` is supported by the upstream provider, the
  final chunk before `[DONE]` includes `usage`.
- If an upstream provider fails mid-stream, the gateway emits an error chunk
  and `[DONE]` so your client's stream parser never hangs.

### GET /v1/models

Lists every configured, operational model:

```jsonc
{
  "object": "list",
  "data": [
    {
      "id": "groq/llama-3.3-70b-versatile",
      "object": "model",
      "created": 1735689600,
      "owned_by": "groq",
      "context_length": 131072,
      "pricing": { "input": "0.5900", "output": "0.7900" }
    }
    // ...
  ]
}
```

### Response headers

Every completion response carries routing telemetry:

| Header | Meaning |
| --- | --- |
| `x-gateway-provider` | Provider that actually served the request (`groq`, `openrouter`, `opencode`) |
| `x-gateway-model` | Model id used upstream (after rewriting) |
| `x-gateway-failovers` | Number of failed attempts before success (`0` normally) |
| `x-gateway-latency-ms` | Total gateway latency in ms |
| `x-gateway-cache` | `HIT` / `MISS` for deterministic (temperature=0) non-stream requests |
| `x-rate-limit-limit` | Requests-per-minute cap for your key |
| `x-rate-limit-remaining` | Requests left in the current window |

### Errors

| Status | Meaning |
| --- | --- |
| `401` | Missing / invalid API key |
| `400` | Malformed request (bad JSON, no messages) |
| `404` | Unknown model id |
| `429` | Rate limit exceeded (client or upstream), no fallback succeeded — includes `Retry-After` |
| `502` | All providers failed (offline / timeout / server error) |
| `504` | Upstream timeout |
| `499` | Client disconnected mid-stream |

Error bodies follow the OpenAI shape: `{"error": {"message", "type", "code"}}`.

### Failover & routing

The router implements **sticky success**:

1. Requested model → try it first (if its provider has been healthy recently).
2. On **401 / 403 / 404 / 429 / 5xx / timeout / network error**, it falls back
   to the next entry in `MODEL_FALLBACK_CHAIN` **without breaking the
   connection** (streaming fails over before the first token).
3. Providers that fail get a 30-second cooldown; providers that succeed stay
   prioritized.
4. Every attempt is logged; `/status` shows failover events with arrows.

### Rate limiting

Every API key gets a sliding-window rate limit (default **120 requests/minute**).
When exceeded you get `429` with a `Retry-After` header. Configure:

```env
RATE_LIMIT_RPM=120     # requests per minute per key — set 0 to disable
```

### Deterministic response cache

Identical non-streaming requests with `temperature: 0` (no tools) are served
from an in-memory cache, so repeated agent calls cost nothing and return
instantly. Responses include `x-gateway-cache: HIT`. Configure:

```env
CACHE_TTL_SECONDS=60   # seconds a cached response lives — set 0 to disable
CACHE_MAX_ENTRIES=200  # LRU cap
```

Default chain (edit `MODEL_FALLBACK_CHAIN` in `.env`):

```
groq/llama-3.3-70b-versatile
  → openrouter/nvidia/nemotron-3-ultra-550b-a55b:free
  → openrouter/openrouter/free
  → opencode/nemotron-3-ultra-free
  → opencode/deepseek-v4-flash-free
```

---

## Using it with coding agents

### Claude Code

Claude Code speaks the **Anthropic** API protocol, so it cannot talk to an
OpenAI-compatible endpoint directly. Use **Claude Code Router (CCR)** — a small
free local gateway that translates Anthropic ↔ OpenAI and is built exactly for
this:

1. Install CCR (Node 22+):
   ```bash
   npm install -g @musistudio/claude-code-router
   ccr ui
   ```
   (or download the desktop app from
   https://github.com/musistudio/claude-code-router/releases)
2. In the CCR UI open **Providers → Add Provider → Custom**:
   - **Base URL**: `http://localhost:3000/v1`
   - **API key**: `nishan-bajagain`
   - **Protocol**: OpenAI
   - **Models**: paste the five model ids from [The free models](#the-free-models)
3. Open **Server → Start**. CCR now listens at `http://127.0.0.1:3456`.
4. Open **Agent Config → Claude Code**, pick a model (e.g.
   `groq/llama-3.3-70b-versatile`), apply the profile, then start `claude`.

All requests now flow: `Claude Code → CCR → hamro.site → provider`, with
failover handled by the gateway. (If you'd rather use a LiteLLM proxy, point
Claude Code at LiteLLM's `/anthropic` route with `ANTHROPIC_BASE_URL` and have
LiteLLM forward to this gateway.)

### Cursor

1. Cursor Settings → **Models** → **OpenAI API Key**: enter `nishan-bajagain`.
2. **Override OpenAI Base URL**: `http://localhost:3000/v1`.
3. Add the model ids (e.g. `groq/llama-3.3-70b-versatile`) and enable them.
4. Pick one in the model picker and chat.

Cursor sends OpenAI-format requests, so it works directly — no proxy needed.

### Aider

```bash
aider \
  --openai-api-base http://localhost:3000/v1 \
  --openai-api-key nishan-bajagain \
  --model openai/groq/llama-3.3-70b-versatile
```

> Aider's model name is `openai/<id>` — the `openai/` prefix tells Aider "this
> is an OpenAI-compatible chat model", it does **not** send requests to OpenAI.

### OpenCode / Continue / other agents

Anything that supports a custom OpenAI-compatible endpoint works directly:

| Setting | Value |
| --- | --- |
| Base URL / API base | `http://localhost:3000/v1` |
| API key | `nishan-bajagain` |
| Model | any id from `/v1/models` |

This includes OpenCode (the CLI), Continue, Roo Code, Cline, Windsurf, Zed,
Raycast AI, and custom scripts.

---

## Getting free API keys

The gateway ships with working keys, but if you deploy your own instance you
need your own (all free):

| Provider | Where | Free tier |
| --- | --- | --- |
| **Groq** | https://console.groq.com/keys | Free tier with generous rate limits; `llama-3.3-70b-versatile` is free |
| **OpenRouter** | https://openrouter.ai/keys | Free models (`:free` suffix, `openrouter/free`) cost $0 |
| **OpenCode Zen** | https://opencode.ai (sign in → API keys) | Free models: `nemotron-3-ultra-free`, `deepseek-v4-flash-free` |

Copy them into `.env`:

```env
PUBLIC_API_KEY="nishan-bajagain"
GROQ_API_KEY="gsk_..."
OPENROUTER_API_KEY="sk-or-..."
OPENCODE_API_KEY="sk-..."
OPENCODE_BASE_URL="https://opencode.ai/zen/v1"
MODEL_FALLBACK_CHAIN="groq/llama-3.3-70b-versatile,openrouter/nvidia/nemotron-3-ultra-550b-a55b:free,openrouter/openrouter/free,opencode/nemotron-3-ultra-free,opencode/deepseek-v4-flash-free"
```

---

## Self-hosting & deployment

### Local

```bash
npm install
npm run dev        # http://localhost:3000
# or production:
npm run build && npm start
```

### Vercel / Netlify / any serverless host

**No database needed.** The gateway stores telemetry in a JSON file
(`data.json`) and automatically falls back to in-memory storage on read-only
serverless filesystems, so it deploys and runs as-is:

```bash
vercel
# set the env vars above in the Vercel dashboard (or `vercel env add`)
```

Tips for serverless:

- Set `DATA_FILE` to a writable absolute path if you have a mounted volume
  (e.g. `/data/hamro-data.json`) to persist telemetry across cold starts.
- Without a volume, `/status` still works — data just resets on cold restart.
- OpenCode Zen and free OpenRouter models can be slow on first token
  (5–20 s). Raise your platform's function timeout if you see `504`s.

### VPS / Docker-friendly hosts

`data.json` is written to the project root by default — it persists across
restarts. Back it up with the rest of the project.

---

## Data, telemetry & the status page

- **`/status`** — live dashboard: provider health grid, aggregate + per-model
  usage (requests, prompt/completion tokens, estimated cost, avg latency),
  color-coded event log with failover arrows. Auto-refreshes health checks.
- **`/api/status`** — the same data as JSON.
- **`POST /api/healthcheck`** — pings every provider and updates status.
- **`GET /api/health`** — lightweight unauthenticated probe (provider status, uptime,
  request count) for uptime monitors and Vercel Cron; `200` when all providers are online,
  `503` when degraded.
- **`data.json`** — all request logs + provider status (max 5,000 recent
  records; oldest pruned). Plain JSON, no database engine.

Storage resolution order: `DATA_FILE` env → `./data.json` → `/tmp/hamro-data.json`
→ in-memory fallback.

---

## Security notes

- `nishan-bajagain` is the **public** shared key — anyone with it can use your
  gateway. Change `PUBLIC_API_KEY` in `.env` if you want to restrict access,
  and treat anything pasted into chat/forums as compromised (rotate provider
  keys too if they were shared publicly).
- `.env` is gitignored. Never commit provider keys.
- CORS is wide open (`*`) on `/v1/*` so browser-based agents work. Lock it down
  in `next.config.ts` if you deploy publicly.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `401 Invalid API key` | Check `Authorization: Bearer <PUBLIC_API_KEY>`. |
| `429` on Groq | Groq free tier is rate-limited — the router auto-falls back to OpenRouter/OpenCode; watch `x-gateway-failovers`. |
| Slow first token on OpenCode models | Normal for free reasoning models (5–20 s). Streaming shows partial reasoning as it arrives. |
| `502 All providers failed` | Check each provider key in `.env` and run `POST /api/healthcheck`; look at `/status` for the failing provider's error. |
| `429 rate limit exceeded` | You exceeded `RATE_LIMIT_RPM` — check the `Retry-After` header and back off, or raise the limit. |
| `/status` resets on deploy | Serverless in-memory fallback — set `DATA_FILE` to a persistent volume. |
| Claude Code won't connect | Claude Code needs Anthropic protocol — use CCR (see [Claude Code](#claude-code)). |

---

*Last updated: August 2026 · hamro.site free AI gateway.*
