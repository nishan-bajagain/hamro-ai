#!/usr/bin/env node
/**
 * End-to-end test for lib/db/store.ts remote JSON mirror — the free
 * 3rd-party JSON persistence (jsonblob.com auto-mode or an explicit
 * REMOTE_JSON_URL) that keeps /status data across serverless cold starts.
 *
 * Simulates a jsonblob.com-style server (POST creates a blob + Location
 * header, GET/PUT read/update it, blobs can "expire"):
 *   1. auto-mode: first write creates a blob and the snapshot lands in it
 *   2. auto-mode recall: a restarted process (same data.json) finds the blob
 *      via meta.remoteUrl and loads the snapshot from it
 *   3. explicit REMOTE_JSON_URL: instance A writes → instance B (cold start,
 *      no file) reads the snapshot back from the remote
 *   4. self-heal: when the blob expires, the next write recreates it and the
 *      data survives under a fresh URL
 *
 * Run: node scripts/verify-remote.mjs
 */
import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";
import fs from "node:fs";
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

// ── Mock jsonblob server ──
const blobs = new Map(); // id -> { snapshot, expired }
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  res.setHeader("Content-Type", "application/json");
  const send = (code, body) => {
    res.statusCode = code;
    res.end(body === undefined ? "" : JSON.stringify(body));
  };
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    // Admin helpers
    if (url.pathname.startsWith("/expire/")) {
      const b = blobs.get(url.pathname.slice(8));
      if (b) b.expired = true;
      return send(200, { ok: true });
    }
    if (url.pathname === "/blobs") {
      return send(200, [...blobs.entries()].map(([id, b]) => ({ id, expired: b.expired, len: b.snapshot.length })));
    }
    if (url.pathname === "/api/jsonBlob") {
      if (req.method === "POST") {
        const id = randomUUID();
        blobs.set(id, { snapshot: body, expired: false });
        res.setHeader("Location", `/api/jsonBlob/${id}`);
        return send(201, { id });
      }
      return send(405, { error: "method not allowed" });
    }
    const m = /^\/api\/jsonBlob\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (m) {
      const b = blobs.get(m[1]);
      if (!b || b.expired) return send(404, { error: "blob not found or expired" });
      if (req.method === "GET") return send(200, JSON.parse(b.snapshot || "null"));
      if (req.method === "PUT") {
        b.snapshot = body;
        return send(200, { ok: true });
      }
    }
    return send(404, { error: "not found" });
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

function runNode(script, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", script], {
      env: { ...process.env, ...env },
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

const logRequest = (model) => `
  const { store } = await import(${JSON.stringify(storeUrl)});
  await store.addRequest({
    requestedModel: ${JSON.stringify(model)}, servedModel: ${JSON.stringify(model)}, provider: "test",
    statusCode: 200, stream: false, promptTokens: 3, completionTokens: 5,
    totalTokens: 8, costUsd: 0, latencyMs: 12, ttftMs: null,
    failovers: 0, error: null, client: "verify", cached: false,
  });
  await new Promise((r) => setTimeout(r, 900));
  process.exit(0);
`;

const readRequests = `
  const { store } = await import(${JSON.stringify(storeUrl)});
  const reqs = await store.requests();
  console.log(JSON.stringify(reqs.map((r) => r.requestedModel)));
  process.exit(0);
`;

/** Fetch a blob and return its decompressed `requests` array. */
async function blobRequests(id) {
  const res = await fetch(`${base}/api/jsonBlob/${id}`);
  const outer = await res.json();
  const text =
    outer?.gz === 1 ? gunzipSync(Buffer.from(outer.data, "base64")).toString() : JSON.stringify(outer);
  return JSON.parse(text).requests ?? [];
}

const tmpDataFile = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  `../.freebuff/verify-remote-${Date.now()}.json`,
);

try {
  // ── 1. auto-mode: no REMOTE_JSON_URL, no KV → first persist creates a blob ──
  const autoEnv = { VERCEL: "1", DATA_FILE: tmpDataFile, JSONBLOB_API_URL: `${base}/api/jsonBlob` };
  await runNode(logRequest("auto-mode/model-a"), autoEnv);
  let blobsList = JSON.parse(
    (await new Promise((res, rej) =>
      http.get(`${base}/blobs`, (r) => {
        let d = "";
        r.on("data", (c) => (d += c));
        r.on("end", () => res(d));
      }).on("error", rej),
    )),
  );
  check(
    "auto-mode created a jsonblob blob on first write",
    blobsList.length === 1 && blobsList[0].len > 0,
    JSON.stringify(blobsList),
  );
  check(
    "auto-mode snapshot contains the request",
    blobsList[0]?.len > 0 &&
      (await blobRequests(blobsList[0].id)).some((r) => r.requestedModel === "auto-mode/model-a"),
  );

  // ── 2. auto-mode recall: a restarted process (same data.json) finds the blob ──
  const recallOut = await runNode(readRequests, autoEnv);
  check(
    "restarted process recalled the blob URL from data.json and loaded it",
    JSON.parse(recallOut.trim().split("\n").pop()).includes("auto-mode/model-a"),
    recallOut,
  );

  // ── 3. explicit REMOTE_JSON_URL: cold-start instance B reads instance A's write ──
  const stableId = randomUUID();
  blobs.set(stableId, { snapshot: "{}", expired: false });
  const stableUrl = `${base}/api/jsonBlob/${stableId}`;
  await runNode(logRequest("explicit/model-b"), {
    VERCEL: "1",
    REMOTE_JSON_URL: stableUrl,
    JSONBLOB_API_URL: `${base}/api/jsonBlob`,
    DATA_FILE: path.join(tmpDataFile, "..", `verify-remote-b-${Date.now()}.json`),
  });
  const coldOut = await runNode(readRequests, {
    VERCEL: "1",
    REMOTE_JSON_URL: stableUrl,
    JSONBLOB_API_URL: `${base}/api/jsonBlob`,
    DATA_FILE: path.join(tmpDataFile, "..", `verify-remote-c-${Date.now()}.json`),
  });
  check(
    "cold-start instance read the snapshot back from the remote URL",
    JSON.parse(coldOut.trim().split("\n").pop()).includes("explicit/model-b"),
    coldOut,
  );

  // ── 4. self-heal (auto-mode): the remembered blob expires → next write
  //    recreates it and the data survives under a fresh URL ──
  await fetch(`${base}/expire/${stableId}`);
  const healedFile = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    `../.freebuff/verify-remote-heal-${Date.now()}.json`,
  );
  // No `counters` key on purpose — deserialize backfills them.
  fs.writeFileSync(
    healedFile,
    JSON.stringify({ requests: [], providerStatus: {}, chats: {}, nextId: 0, meta: { remoteUrl: stableUrl } }),
  );
  await runNode(logRequest("self-heal/model-c"), {
    VERCEL: "1",
    JSONBLOB_API_URL: `${base}/api/jsonBlob`,
    DATA_FILE: healedFile,
  });
  blobsList = JSON.parse(
    await new Promise((res, rej) =>
      http.get(`${base}/blobs`, (r) => {
        let d = "";
        r.on("data", (c) => (d += c));
        r.on("end", () => res(d));
      }).on("error", rej),
    ),
  );
  const live = blobsList.filter((b) => !b.expired);
  const healedAny = [];
  for (const b of live) {
    if ((await blobRequests(b.id)).some((r) => r.requestedModel === "self-heal/model-c")) {
      healedAny.push(b.id);
    }
  }
  check(
    "expired blob was recreated (self-heal) and the data survived",
    healedAny.length > 0,
    JSON.stringify(blobsList),
  );
} finally {
  server.close();
}

console.log(
  failures === 0
    ? "\nAll remote-mirror checks passed \u2705"
    : `\n${failures} check(s) FAILED \u274C`,
);
process.exit(failures === 0 ? 0 : 1);
