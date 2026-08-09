# hamro.site — Free AI Gateway · Full Documentation

A single, OpenAI-compatible API that gives you **free access to multiple frontier
models** through one key and one URL. It aggregates ten providers — **Groq**,
**OpenRouter**, **OpenCode Zen**, **Ollama Cloud**, **Naga AI**, **ZenMux**, **LLM7**,
**Cerebras**, **Chutes** and **HuggingFace** — into a smart routing layer with
automatic failover, so coding agents (Claude Code, Cursor, Aider, OpenCode, custom
CLIs) never see a broken connection.

```
Your agent / script
        │  OpenAI-compatible calls, one key
        ▼
  ┌───────────────────┐
  │  hamro.site       │   /v1/chat/completions, /v1/models
  │  smart router     │   sticky success + auto-failover
  │  random mode      │   model: "random" → pinned per session
  └─────────┬─────────┘
            │
   ┌────────┼────────────┬──────────┬───────────┬───────────┐
   ▼        ▼            ▼          ▼           ▼           ▼
 Groq    OpenRouter  OpenCode   Ollama     Naga AI    HuggingFace
(llama) (nemotron)  (deepseek) (nemotron)  (nemotron)  (llama, deepseek)
 + ZenMux · LLM7 · Cerebras · Chutes
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

Nearly every model is **100% free** (the router also tracks estimated cost for the
paid fallback entries). The full catalog is always available from `GET /v1/models`;
highlights:

| Model id (use this in `model`) | Provider | Context | Notes |
| --- | --- | --- | --- |
| `groq/llama-3.3-70b-versatile` | Groq | 131k | Very fast, great general coding |
| `ollama/nemotron-3-ultra` | Ollama Cloud | 262k | Nemotron 3 Ultra, free cloud tier |
| `ollama/gpt-oss:120b` | Ollama Cloud | 131k | GPT-OSS 120B, free |
| `naga/nemotron-3-ultra-550b-a55b:free` | Naga AI | 1M | Nemotron 3 Ultra, free |
| `naga/nemotron-3-super-120b-a12b:free` | Naga AI | 1M | Nemotron 3 Super, free |
| `naga/llama-3.3-70b-instruct:free` | Naga AI | 131k | Llama 3.3 70B, free |
| `naga/llama-4-scout-17b-16e-instruct:free` | Naga AI | 1M | Llama 4 Scout, free |
| `llm7/gpt-oss:20b` | LLM7 | 128k | GPT-OSS 20B, free turbo tier |
| `huggingface/meta-llama/Llama-3.3-70B-Instruct` | HuggingFace | 131k | Llama 3.3 70B |
| `huggingface/deepseek-ai/DeepSeek-V4-Flash` | HuggingFace | 1M | DeepSeek V4 Flash |
| `huggingface/zai-org/GLM-5.2` | HuggingFace | 1M | GLM 5.2 |
| `zenmux/deepseek/deepseek-v4-flash-free` | ZenMux | 131k | DeepSeek V4 Flash, free |
| `zenmux/z-ai/glm-4.7-flash-free` | ZenMux | 131k | GLM 4.7 Flash, free |
| `cerebras/zai-glm-4.7` | Cerebras | 131k | GLM 4.7 on Cerebras |
| `openrouter/openrouter/free` | OpenRouter | 200k | Auto-routes to OpenRouter's best free model |
| `opencode/deepseek-v4-flash-free` | OpenCode Zen | 131k | DeepSeek V4 Flash, free, shows reasoning |
| `random` | any | — | **Picks a random model, pinned per session** (see below) |

You can also pass a **bare model id** (`llama-3.3-70b-versatile`) — the router
resolves it against the catalog automatically.

> The canonical id is `provider/model`. Because the OpenRouter model id is
> itself `openrouter/free`, its canonical id is `openrouter/openrouter/free`.

### Random model mode

Set `"model": "random"` (alias `"auto"`) and the gateway picks a random configured
model the first time your session asks. That model is then **pinned to your
session**: every later request from the same client keeps using the exact same
model — it never switches on its own. The pin is released only when:

- the session goes idle past `RANDOM_SESSION_TTL_SECONDS` (default 1 hour), or
- the pinned model returns an error (401/402/403/404/429/5xx, timeout, network
  failure) — the request then fails over to other random models and the next
  request picks a fresh random one.

Sessions are identified by (API key + `x-session-id` header, else the request
`user` field, else a client fingerprint). Every random response includes the
`X-Gateway-Session-Model` header with the canonical model that was actually used,
so you always know which model served you.

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

### Chat history database (`/api/chats`)

The web client saves its chat history to the gateway's own database
(`data.json` — the same file as telemetry) instead of an online JSON-blob
service. Every endpoint requires the Bearer key and is **namespaced per key**
(the key is hashed, so raw keys never hit the file), so one user can never
read another's chats.

| Endpoint | Description |
| --- | --- |
| `GET /api/chats` | Chat summaries — add `?full=1` to include messages |
| `GET /api/chats/:id` | One full chat (404 when missing) |
| `POST /api/chats` | Create/update — `{id?, title, messages}` or `{chats: […]}` (bulk) |
| `DELETE /api/chats/:id` | Delete one chat (204 / 404) |
| `DELETE /api/chats` | Delete every chat for this key |

```bash
# Save a chat
curl http://localhost:3000/api/chats \
  -H "Authorization: Bearer nishan-bajagain" \
  -H "Content-Type: application/json" \
  -d '{"id":"chat_1","title":"Refactor","messages":[{"role":"user","content":"hi"}]}'

# List summaries
curl http://localhost:3000/api/chats -H "Authorization: Bearer nishan-bajagain"
```

Enforced limits (400 on violation): **50 chats per key, 200 messages per chat,
200 KB per chat, 8 KB per message, 100-char titles.** Chats persist to
`data.json` and mirror to KV on serverless hosts, so history survives restarts
wherever telemetry does.

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
  → ollama/nemotron-3-ultra
  → naga/nemotron-3-ultra-550b-a55b:free
  → llm7/gpt-oss:20b
  → huggingface/meta-llama/Llama-3.3-70B-Instruct
  → openrouter/nvidia/nemotron-3-ultra-550b-a55b:free
  → zenmux/deepseek/deepseek-v4-flash-free
  → cerebras/zai-glm-4.7
  → chutes/deepseek-ai/DeepSeek-V4-Flash-0731-TEE
  → opencode/nemotron-3-ultra-free
  → opencode/deepseek-v4-flash-free
```

---

## Using it with coding agents

### Claude Code

The gateway speaks the **Anthropic Messages protocol natively**
(`POST /v1/messages` + `/v1/messages/count_tokens`), so Claude Code connects
**directly — no proxy needed**. Claude Code's own Anthropic SDK calls the
endpoint, which translates to the same smart router every other client uses
(failover, `random` session pinning, tools, telemetry all work).

**One command (recommended):**

```bash
cd hamro.ai
npm run claude              # starts the gateway if needed + opens Claude Code
```

What it does:

1. Starts the gateway on port 3000 if it isn't already running (builds it on
   first run, logs to `.freebuff/hamro-server.log`).
2. Writes an **isolated** settings file (`.freebuff/claude-settings.json`) that
   points Claude Code at the gateway — your global `~/.claude/settings.json` is
   never modified. This matters because a global settings-file `env` block
   overrides shell environment variables.
3. Sets `ANTHROPIC_MODEL` (default `random` — a model is picked once per
   session and pinned until it errors) and `ANTHROPIC_SMALL_FAST_MODEL` for
   background tasks.
4. Opens the Claude Code TUI.

Useful variants:

```bash
npm run claude -- --check                    # verify gateway + config, don't open
npm run claude -- --model groq/llama-3.3-70b-versatile   # pin a specific model
npm run claude -- --restart                  # force-restart a stale gateway build
npm run claude -- --port 4000                # different port
```

**Manual equivalent** (if you don't want to use the launcher): create
`~/.claude/settings.json` with:

```jsonc
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:3000",   // no /v1 — Claude Code appends it
    "ANTHROPIC_AUTH_TOKEN": "nishan-bajagain",       // your gateway key
    "ANTHROPIC_MODEL": "random",                     // or any model id from /v1/models
    "ANTHROPIC_SMALL_FAST_MODEL": "groq/llama-3.3-70b-versatile"
  }
}
```

(If you prefer a proxy instead, **Claude Code Router (CCR)** still works: install
`npm install -g @musistudio/claude-code-router`, add a custom OpenAI provider
pointing at `http://localhost:3000/v1` with key `nishan-bajagain`, start the CCR
server, and point Claude Code at `http://127.0.0.1:3456`.)

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
| **Ollama Cloud** | https://ollama.com (sign in → API keys) | Free cloud models (`nemotron-3-ultra`, `gpt-oss:120b`, …) |
| **Naga AI** | https://naga.ac | Free models with `:free` suffix |
| **ZenMux** | https://zenmux.ai | Free models with `-free` suffix |
| **LLM7** | https://llm7.io | Free turbo tier (`gpt-oss:20b`, `gemma4:31b`, …) |
| **Cerebras** | https://cloud.cerebras.ai | Free tier models (`zai-glm-4.7`, …) |
| **Chutes** | https://chutes.ai | TEE-hosted open models |
| **HuggingFace** | https://huggingface.co/settings/tokens | Free inference with monthly credits |

Copy them into `.env` (see `.env.example` for the full template):

```env
PUBLIC_API_KEY="nishan-bajagain"
GROQ_API_KEY="gsk_..."
OPENROUTER_API_KEY="sk-or-..."
OPENCODE_API_KEY="sk-..."
OPENCODE_BASE_URL="https://opencode.ai/zen/v1"
OLLAMA_API_KEY="..."
NAGA_API_KEY="ng-..."
ZENMUX_API_KEY="sk-mg-v1-..."
LLM7_API_KEY="..."
CEREBRAS_API_KEY="csk-..."
CHUTES_API_KEY="cpk_..."
HUGGINGFACE_API_KEY="hf_..."
MODEL_FALLBACK_CHAIN="groq/llama-3.3-70b-versatile,ollama/nemotron-3-ultra,naga/nemotron-3-ultra-550b-a55b:free,llm7/gpt-oss:20b,huggingface/meta-llama/Llama-3.3-70B-Instruct,openrouter/nvidia/nemotron-3-ultra-550b-a55b:free,zenmux/deepseek/deepseek-v4-flash-free,cerebras/zai-glm-4.7,chutes/deepseek-ai/DeepSeek-V4-Flash-0731-TEE,opencode/nemotron-3-ultra-free,opencode/deepseek-v4-flash-free"
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

**To keep `/status` data across cold starts on Vercel**, two free options
(no database, no signup for the first one):

**Option 1 — free remote JSON (zero setup).** The gateway auto-creates a free
[jsonblob.com](https://jsonblob.com) blob on first write, remembers its URL in
`data.json`, reuses it across restarts, and self-heals when the blob expires
(jsonblob's free tier keeps blobs ~24h — a rolling window that matches the
dashboard's "last 24h" focus). Telemetry then survives serverless cold starts
with nothing to configure:

```env
# optional — durable endpoint you control (any JSON service speaking GET/PUT):
# REMOTE_JSON_URL="https://jsonblob.com/api/jsonBlob/<id>"
```

Paste a `https://jsonblob.com/<id>` viewer URL and it is normalized to the API
URL automatically. For permanent history, set `REMOTE_JSON_URL` to any durable
JSON endpoint (or use Option 2).

**Option 2 — Vercel KV / Upstash.** Add a free
[Vercel KV / Upstash Redis](https://vercel.com/docs/storage/vercel-kv) store
and set its two env vars. The gateway persists telemetry to the shared KV (via
plain `fetch` — no extra dependencies), so data survives instance recycling
and restarts durably:

```env
KV_REST_API_URL="https://your-kv.upstash.io"
KV_REST_API_TOKEN="AUpX..."
```

Without any of the above:

- Set `DATA_FILE` to a writable absolute path if you have a mounted volume
  (e.g. `/data/hamro-data.json`) to persist telemetry across cold starts.
- Otherwise `/status` still works — data just resets when the instance
  recycles (Vercel's `/tmp` is per-instance and ephemeral).

OpenCode Zen and free OpenRouter models can be slow on first token
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
  records; oldest pruned) **plus the chat-history database** (`chats` section,
  namespaced per key). Plain JSON, no database engine.

Storage resolution order: shared **KV** (`KV_REST_API_URL` + `KV_REST_API_TOKEN`,
optional — the only layer that survives across serverless instances) →
`DATA_FILE` env → `./data.json` → `/tmp/hamro-data.json` → in-memory fallback.

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
| `/status` resets on deploy | Vercel instances are ephemeral — add a free Vercel KV / Upstash store and set `KV_REST_API_URL` + `KV_REST_API_TOKEN` (or mount a volume via `DATA_FILE`). |
| Claude Code won't connect | The gateway speaks Anthropic natively — run `npm run claude -- --check` and confirm the gateway is up on port 3000 (see [Claude Code](#claude-code)). |

---

*Last updated: August 2026 · hamro.site free AI gateway.*
