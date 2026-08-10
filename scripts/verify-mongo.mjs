#!/usr/bin/env node
/**
 * End-to-end verification that ALL gateway data (status/telemetry/usage,
 * provider health and chat history) persists to MongoDB and survives a
 * cold start.
 *
 * Uses a REAL MongoDB instance — `mongodb-memory-server` downloads a
 * platform mongod binary on first run (cached afterwards), so this is not a
 * mock: the store talks to an actual MongoDB server over the driver.
 *
 *   1. instance A (child process) writes: a request, a provider status,
 *      and a chat → store persists to MongoDB
 *   2. parent inspects the raw MongoDB document directly
 *   3. instance B (fresh child = cold start) loads from MongoDB and reads
 *      the request, provider status and chat back
 *
 * Run: node scripts/verify-mongo.mjs
 */
import { MongoClient } from "mongodb";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
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

const { MongoMemoryServer } = await import("mongodb-memory-server");
const mongod = await MongoMemoryServer.create();
const mongoUri = mongod.getUri(); // mongodb://127.0.0.1:<port>/
console.log(`in-memory MongoDB listening at ${mongoUri}`);

// Keep the store's file layer out of the real data.json.
const dataFile = path.join(os.tmpdir(), `hamro-mongo-test-${process.pid}.json`);
const env = {
  ...process.env,
  MONGODB_URI: mongoUri,
  DATA_FILE: dataFile,
  MONGODB_DB: "hamro",
};

function runNode(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", script], {
      env,
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
  // ── Instance A: write a request, a provider status, and a chat ──
  const writeSide = `
    const { store } = await import(${JSON.stringify(storeUrl)});
    await store.addRequest({
      requestedModel: "mistral/mistral-small-latest", servedModel: "mistral-small-latest",
      provider: "mistral", statusCode: 200, stream: true, promptTokens: 10,
      completionTokens: 20, totalTokens: 30, costUsd: 0, latencyMs: 500,
      ttftMs: 200, failovers: 1, error: null, client: "verify-mongo", cached: false,
    });
    await store.upsertProviderStatus("mistral", {
      status: "online", latencyMs: 500, successes: 3, failures: 1,
      lastError: null, lastModel: "mistral-small-latest",
    });
    const saved = await store.upsertChat("test-owner", {
      id: "chat_verify", title: "Mongo test",
      messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }],
    });
    if (!saved.ok) throw new Error("upsertChat failed: " + saved.error);
    await new Promise((r) => setTimeout(r, 1200)); // debounce 300ms + Mongo write
    process.exit(0);
  `;
  await runNode(writeSide);
  check("instance A persisted to MongoDB without error", true);

  // ── Parent: inspect the raw MongoDB document ──
  const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const doc = await client.db("hamro").collection("store").findOne({ _id: "telemetry" });
  check("raw MongoDB doc 'hamro.store.telemetry' exists", Boolean(doc));
  let snapshot = null;
  if (doc && typeof doc.snapshot === "string") {
    snapshot = JSON.parse(doc.snapshot);
    check(
      "doc contains the request (status/usage data)",
      Array.isArray(snapshot.requests) && snapshot.requests.some((r) => r.requestedModel === "mistral/mistral-small-latest" && r.provider === "mistral" && r.totalTokens === 30),
      JSON.stringify((snapshot.requests || []).map((r) => r.requestedModel)),
    );
    check(
      "doc contains provider status",
      snapshot.providerStatus?.mistral?.status === "online" && snapshot.providerStatus.mistral.successes === 3,
      JSON.stringify(snapshot.providerStatus?.mistral),
    );
    check(
      "doc contains the chat history",
      snapshot.chats?.["test-owner"]?.some((c) => c.id === "chat_verify" && c.messages.length === 2),
      JSON.stringify(Object.keys(snapshot.chats || {})),
    );
    check(
      "doc contains incremental counters (usage totals)",
      snapshot.counters?.requests === 1 && snapshot.counters?.perProvider?.mistral?.requests === 1,
      JSON.stringify(snapshot.counters?.perProvider),
    );
  }
  await client.close();

  // ── Instance B: cold start — everything must load back from MongoDB ──
  const readSide = `
    const { store } = await import(${JSON.stringify(storeUrl)});
    const reqs = await store.requests();
    const statuses = await store.providerStatuses();
    const chats = await store.chatsFor("test-owner");
    const counters = await store.counters();
    console.log(JSON.stringify({
      reqs: reqs.map((r) => ({ model: r.requestedModel, provider: r.provider, tokens: r.totalTokens })),
      statuses: statuses.map((s) => ({ provider: s.provider, status: s.status, successes: s.successes })),
      chats: chats.map((c) => ({ id: c.id, n: c.messages.length })),
      counters: { requests: counters.requests, perProvider: counters.perProvider },
    }));
    process.exit(0);
  `;
  const out = await runNode(readSide);
  const parsed = JSON.parse(out.trim().split("\n").pop());
  check(
    "cold start read the request back from MongoDB",
    Array.isArray(parsed.reqs) && parsed.reqs.some((r) => r.model === "mistral/mistral-small-latest" && r.provider === "mistral" && r.tokens === 30),
    JSON.stringify(parsed.reqs),
  );
  check(
    "cold start read provider status back from MongoDB",
    Array.isArray(parsed.statuses) && parsed.statuses.some((s) => s.provider === "mistral" && s.status === "online" && s.successes === 3),
    JSON.stringify(parsed.statuses),
  );
  check(
    "cold start read the chat back from MongoDB",
    Array.isArray(parsed.chats) && parsed.chats.some((c) => c.id === "chat_verify" && c.n === 2),
    JSON.stringify(parsed.chats),
  );
  check(
    "cold start read counters (usage totals) back from MongoDB",
    parsed.counters?.requests === 1 && parsed.counters?.perProvider?.mistral?.requests === 1,
    JSON.stringify(parsed.counters),
  );
} finally {
  try {
    fs.rmSync(dataFile, { force: true });
  } catch {
    /* ignore */
  }
  await mongod.stop();
}

console.log(
  failures === 0
    ? "\nAll MongoDB checks passed ✅ — status/usage/chat data fully persists to MongoDB"
    : `\n${failures} check(s) FAILED \u274C`,
);
process.exit(failures === 0 ? 0 : 1);
