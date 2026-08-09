#!/usr/bin/env node
/**
 * End-to-end verification of the documented /v1/chat/completions error
 * contract (README.md / DOCS.md):
 *   - 401  missing/invalid Authorization
 *   - 404  unknown model
 *   - 502  all providers failed (OpenAI-style error body)
 *   - 400  malformed request
 *
 * Requires a running server. Usage:
 *   node scripts/verify-api.mjs [baseUrl] [apiKey] [failModel]
 *
 * `failModel` (optional) enables the 502 test: pass a model that every
 * candidate provider rejects — e.g. run the server with all provider keys
 * invalidated (env overrides) and request a catalog model, so the whole
 * chain fails. Example:
 *   GROQ_API_KEY=x OPENROUTER_API_KEY=x ... npm start
 *   node scripts/verify-api.mjs http://localhost:3000 <key> groq/llama-3.3-70b-versatile
 */
const [baseUrl = "http://localhost:3000", apiKey = "", failModel = ""] =
  process.argv.slice(2);

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) {
    console.log(`  \u2713 ${name}`);
  } else {
    failures += 1;
    console.error(`  \u2717 ${name} ${extra}`);
  }
}

function assertErrorShape(body) {
  const e = body?.error;
  return (
    typeof e === "object" &&
    typeof e.message === "string" &&
    e.message.length > 0 &&
    typeof e.type === "string" &&
    "param" in e &&
    "code" in e
  );
}

async function post(path, body, { auth = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth) headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON body */
  }
  return { res, json };
}

console.log(`verify-api against ${baseUrl}`);

// 1. 401 — no auth header
{
  const { res, json } = await post(
    "/v1/chat/completions",
    { model: "groq/llama-3.3-70b-versatile", messages: [{ role: "user", content: "hi" }] },
    { auth: false },
  );
  check("401 on missing auth", res.status === 401, `got ${res.status}`);
  check("401 body is OpenAI-style", assertErrorShape(json), JSON.stringify(json));
  check("401 code = invalid_api_key", json?.error?.code === "invalid_api_key", String(json?.error?.code));
}

// 2. 404 — unknown model
{
  const { res, json } = await post("/v1/chat/completions", {
    model: "definitely-not-a-real-model-xyz",
    messages: [{ role: "user", content: "hi" }],
  });
  check("404 on unknown model", res.status === 404, `got ${res.status}`);
  check("404 body is OpenAI-style", assertErrorShape(json), JSON.stringify(json));
  check("404 code = model_not_found", json?.error?.code === "model_not_found", String(json?.error?.code));
}

// 3. 400 — malformed request
{
  const { res, json } = await post("/v1/chat/completions", {
    model: "groq/llama-3.3-70b-versatile",
    messages: [],
  });
  check("400 on empty messages", res.status === 400, `got ${res.status}`);
  check("400 body is OpenAI-style", assertErrorShape(json), JSON.stringify(json));
}

// 4. 502 — every provider fails (only when a failModel is supplied)
if (failModel) {
  const { res, json } = await post("/v1/chat/completions", {
    model: failModel,
    messages: [{ role: "user", content: "hi" }],
  });
  check("502 when every provider fails", res.status === 502, `got ${res.status}`);
  check("502 body is OpenAI-style", assertErrorShape(json), JSON.stringify(json));
  check("502 includes x-gateway-failovers", res.headers.get("x-gateway-failovers") !== null, "header missing");
} else {
  console.log("  (skipping 502 test \u2014 pass a failModel arg to run it)");
}

console.log(
  failures === 0
    ? "\nAll API checks passed \u2705"
    : `\n${failures} check(s) FAILED \u274C`,
);
process.exit(failures === 0 ? 0 : 1);
