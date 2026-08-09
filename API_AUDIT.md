# Hamro AI API Audit

Complete audit of every endpoint exposed by the Hamro AI gateway, the
contract the frontend was built against, and how coding agents use it.

- Base URL (local): `http://localhost:3000`
- Base URL (deployed): `https://hamro-ai-lilac.vercel.app` (and `https://hamro.site`)
- Auth: `Authorization: Bearer <PUBLIC_API_KEY>` on every `/v1/*` and `/api/chats/*`
  endpoint. The key is a shared public key, not a per-user secret.
- Error shape (all endpoints): `{ "error": { "message", "type", "param", "code" } }`
- CORS: enabled on every endpoint (`*` origin, `Authorization`,
  `Content-Type`, `x-session-id`, `x-client`, `x-api-key` allowed headers).

---

## 1. List models

`GET /v1/models`

### Purpose
Return every configured model across all providers, plus the virtual
`random` model ("auto"): the router picks a random healthy model and pins it
per session (`x-session-id` header) until the session idles or the model
errors.

### Authentication
`Authorization: Bearer <PUBLIC_API_KEY>` — required (401 without it).

### Request
No body. Optional `?` query: none.

### Response
`200` — `{ "object": "list", "data": [{ "id", "object", "created",
"owned_by", "context_length", "pricing": { "input", "output" } }] }`

### Errors
`401 invalid_api_key` · `429 rate_limit_exceeded` (with `Retry-After`)

### Used by
The web client's model picker (`lib/api/client.ts → listModels`). Providers
with keys are listed; free models report `pricing: {input: "0", output: "0"}`.

---

## 2. Chat completions (OpenAI-compatible)

`POST /v1/chat/completions`

### Purpose
The core chat endpoint. OpenAI request/response format, streaming via SSE
(`data:` lines, `[DONE]` terminator). Routes across providers with automatic
failover; supports the `random` model and per-session model pinning.

### Authentication
`Authorization: Bearer <PUBLIC_API_KEY>` — required.

### Request
```json
{
  "model": "random",
  "messages": [{"role": "user", "content": "hi"}],
  "stream": true,
  "temperature": 0.7,
  "max_tokens": 4096
}
```
Optional headers: `x-session-id` (session pinning for `random`), `x-client`
(client fingerprinting). Body fields: `model`, `messages` (roles
`system|user|assistant|tool|developer`), `stream`, `temperature`, `top_p`,
`max_tokens`, `tools`, `tool_choice`, `response_format`, `stop`,
`presence_penalty`, `frequency_penalty`, `user`, `seed`.

### Response
Non-stream: `200` — OpenAI `chat.completion` with `usage`.
Stream: `200` — `text/event-stream` of `chat.completion.chunk` objects.
Diagnostics on every response:
`X-Gateway-Provider`, `X-Gateway-Model`, `X-Gateway-Failovers`,
`X-Gateway-Session-Model` (random only), `X-Gateway-Cache`,
`X-RateLimit-Limit`, `X-RateLimit-Remaining`.

### Errors
`400` invalid body · `401 invalid_api_key` · `404 model_not_found` ·
`429 rate_limit_exceeded` (client or upstream) · `499` client aborted ·
`500 internal_error` · `502` all providers failed

### Used by
The web client chat (`streamChat`), the standalone `index.html` client, and
every OpenAI-compatible tool (OpenCode, Cursor, aider, OpenAI SDKs).

---

## 3. Messages (Anthropic-compatible)

`POST /v1/messages`

### Purpose
Native Anthropic Messages protocol translation so Claude Code connects
directly — no proxy needed. Translates Anthropic requests/responses to the
OpenAI router (failover, `random`, tools all work).

### Authentication
`Authorization: Bearer <PUBLIC_API_KEY>` **or** `x-api-key` header.

### Request
Anthropic `messages` body: `model`, `max_tokens`, `system` (string or list),
`messages` (roles may include `system` inline), `tools`, `stream`, etc.
`x-claude-code-session-id` is used as the session key for `random` pinning.

### Response
Non-stream: Anthropic `message` object. Stream: Anthropic event sequence
(`message_start` → `content_block_delta` → `message_stop`), including
`input_json_delta` for tool calls.

### Errors
Same contract as `/v1/chat/completions` (401/404/429/499/502), with
Anthropic-style error bodies.

### Used by
`npm run claude` (launcher) → Claude Code via `ANTHROPIC_BASE_URL`.

---

## 4. Token count (Anthropic)

`POST /v1/messages/count_tokens`

### Purpose
Anthropic token-estimation endpoint Claude Code calls during operation.

### Authentication
Same as `/v1/messages`.

### Request
Anthropic messages body (model + messages).

### Response
`200` — `{ "input_tokens": <number> }`

---

## 5. Conversation list

`GET /api/chats`

### Purpose
List saved conversations for the calling key (light summaries, no message
bodies unless `?full=1`).

### Authentication
Required. Namespaced per key (key is hashed — raw keys and other users'
chats never appear in `data.json`).

### Request
Query: `?full=1` includes full `messages` per chat (used by the web client
when restoring offline).

### Response
`200` — `{ "chats": [{ "id", "title", "createdAt", "updatedAt",
"messageCount" }] }`

### Errors
`401` · `429` · `400` on bad input

---

## 6. Conversation detail

`GET /api/chats/:id`

### Purpose
One full conversation, messages included.

### Authentication
Required.

### Response
`200` — `{ "id", "title", "createdAt", "updatedAt", "messages": [{ "role",
"content" }] }` · `404 chat_not_found`

---

## 7. Save conversation

`POST /api/chats`

### Purpose
Create or update a conversation (single `{id?, title, messages}` or bulk
`{chats: [...]}`).

### Authentication
Required.

### Request
```json
{
  "id": "chat_abc",          // omit to create
  "title": "Explain React",
  "messages": [{"role": "user", "content": "…"}, {"role": "assistant", "content": "…"}]
}
```
Caps enforced server-side: 50 chats/key, 200 messages/chat, 200 KB/chat,
8 KB/message, 100-char titles.

### Response
`200` — `{ "chats": [{ summary }] }` · `400` on validation failure ·
`429` rate limit

### Used by
The web client saves every conversation here (debounced), with a
localStorage mirror as an offline cache.

---

## 8. Delete conversation

`DELETE /api/chats/:id` → `204` (or `404` if it didn't exist)

## 9. Clear conversations

`DELETE /api/chats` → `204`, deletes every chat for the calling key

---

## 10. Status / telemetry

`GET /api/status`

### Purpose
Live telemetry dashboard data — totals, per-provider health, per-model
usage, recent event log. Public (no auth).

### Response
`200` — `{ updatedAt, summary, perModel, perProvider, recent }`

### Used by
The status page (`/status`). Persisted to `data.json` (+ optional Vercel KV).

---

## 11. Health probe

`GET /api/health`

### Purpose
Liveness/uptime-monitor probe. Public, coarse only.

### Response
`200` — `{ status: "ok", service, uptimeSeconds, totalRequests, providers }`
or `503` degraded.

### Used by
The web client's sidebar "API online/offline" indicator (polls every 30s).

## 12. Run health check

`POST /api/healthcheck` — public; pings every provider and records status.
`409` while one is already running.

---

## Used vs unavailable

| Endpoint | Used by frontend | Notes |
|---|---|---|
| `GET /v1/models` | ✅ model picker | — |
| `POST /v1/chat/completions` | ✅ chat + streaming | — |
| `POST /v1/messages` | ✅ via Claude Code launcher | — |
| `POST /v1/messages/count_tokens` | ✅ via Claude Code launcher | — |
| `GET/POST/DELETE /api/chats*` | ✅ history + settings | — |
| `GET /api/status`, `GET /api/health`, `POST /api/healthcheck` | ✅ status + sidebar | — |

**Not available / not implemented (no fake fallbacks used):**
- User accounts / per-user auth (single shared public key only).
- Conversation *pinning* — the API has no pin field, so the sidebar omits it.
- Image generation, file upload, usage/billing per user.
- Server-side "feedback" (👍/👎) — no endpoint exists.

## Environment variables

See `.env.example`. Frontend-relevant:
- `NEXT_PUBLIC_PUBLIC_API_KEY` — public key baked into the web client
  (defaults to `nishan-bajagain`).
- `PUBLIC_API_KEY`, provider keys (`GROQ_API_KEY`, …), `RATE_LIMIT_RPM`,
  `CACHE_TTL_SECONDS`, `MODEL_FALLBACK_CHAIN`,
  `RANDOM_SESSION_TTL_SECONDS`.
- Telemetry persistence: **free remote-JSON auto-mode** (jsonblob.com blob,
  zero setup, ~24h rolling window) — nothing to set; `REMOTE_JSON_URL` for a
  durable endpoint, or `KV_REST_API_URL`/`KV_REST_API_TOKEN` (Upstash) for
  permanent serverless persistence.

## Using Hamro AI from coding agents

- **Claude Code** — `npm run claude` (starts the gateway if needed and opens
  Claude Code pointed at `/v1/messages`; `--check` verifies without opening,
  `--model <id>` pins a model).
- **OpenCode / Cursor / aider / OpenAI SDKs** — `export
  OPENAI_BASE_URL=<gateway>/v1` and `export OPENAI_API_KEY=<PUBLIC_API_KEY>`,
  then `opencode`. The `random` model works with any client.

## Running the frontend

```bash
npm install
cp .env.example .env        # fill in provider keys
npm run build               # or npm run dev
npm start                   # http://localhost:3000
npm run lint && npx tsc --noEmit
```
