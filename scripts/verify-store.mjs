#!/usr/bin/env node
/**
 * End-to-end test for lib/db/store.ts shared-KV persistence (the Vercel fix).
 *
 * Simulates two serverless *instances* against one mock Upstash REST server:
 *   1. instance A logs a request  → store PUTs the snapshot to KV
 *   2. instance B (a fresh process, cold start) loads telemetry from KV
 * The data must survive the "instance boundary" — which a per-instance file
 * (data.json / /tmp) can never do on Vercel.
 *
 * Run: node scripts/verify-store.mjs
 */
import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const storeUrl = pathToFileURL(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../lib/db/store.ts"),
).href;

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) {
    console.log(`  \u2713 ${name}`);
  } else {
    failures += 1;
    console.error(`  \u2717 ${name} ${extra}`);
  }
}

// ── Mock Upstash REST KV: GET returns stored value, PUT stores it ──
let stored = null;
const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.method === "GET") {
    res.end(JSON.stringify({ result: stored }));
    return;
  }
  if (req.method === "PUT") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      stored = body;
      res.end(JSON.stringify({ result: "OK" }));
    });
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: "not found" }));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const kvUrl = `http://127.0.0.1:${server.address().port}`;
const kvEnv = {
  ...process.env,
  VERCEL: "1",
  KV_REST_API_URL: kvUrl,
  KV_REST_API_TOKEN: "test-token",
};

function runNode(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", script], {
      env: kvEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("exit", (code) =>
      code === 0 ? resolve(out) : reject(new Error(`child exited ${code}: ${err}`)),
    );
  });
}

try {
  // ── Instance A: log a request, let the debounce + KV PUT land ──
  const writeSide = `
    const { store } = await import(${JSON.stringify(storeUrl)});
    await store.addRequest({
      requestedModel: "test/model-a", servedModel: "test/model-a", provider: "test",
      statusCode: 200, stream: false, promptTokens: 3, completionTokens: 5,
      totalTokens: 8, costUsd: 0, latencyMs: 12, ttftMs: null,
      failovers: 0, error: null, client: "verify", cached: false,
    });
    await new Promise((r) => setTimeout(r, 900)); // debounce 300ms + KV write
    process.exit(0);
  `;
  await runNode(writeSide);
  check("instance A persisted a request to KV", typeof stored === "string" && stored.includes("test/model-a"));

  // ── Instance B: fresh process (cold start) loads from KV ──
  const readSide = `
    const { store } = await import(${JSON.stringify(storeUrl)});
    const reqs = await store.requests();
    console.log(JSON.stringify(reqs.map((r) => ({ model: r.requestedModel, provider: r.provider, tokens: r.totalTokens }))));
    process.exit(0);
  `;
  const out = await runNode(readSide);
  const parsed = JSON.parse(out.trim().split("\n").pop());
  check(
    "instance B (cold start) read the request back from KV",
    Array.isArray(parsed) && parsed.some((r) => r.model === "test/model-a" && r.provider === "test" && r.tokens === 8),
    JSON.stringify(parsed),
  );
} finally {
  server.close();
}

console.log(
  failures === 0
    ? "\nAll store checks passed \u2705"
    : `\n${failures} check(s) FAILED \u274C`,
);
process.exit(failures === 0 ? 0 : 1);
