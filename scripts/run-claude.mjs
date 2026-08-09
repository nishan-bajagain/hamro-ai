#!/usr/bin/env node
/**
 * One-command launcher — `npm run claude`
 *
 *  1. Ensures the hamro.ai gateway is running (builds once, then starts it
 *     detached on the configured port, logging to .freebuff/hamro-server.log).
 *  2. Points Claude Code at it via ANTHROPIC_* env vars — no proxy needed:
 *     the gateway now speaks the Anthropic Messages protocol natively
 *     (POST /v1/messages + /v1/messages/count_tokens).
 *  3. Opens Claude Code, forwarding any extra args (e.g. `-p "question"`).
 *
 * Usage:
 *   npm run claude                start gateway + open Claude Code
 *   npm run claude -- --check     verify config + gateway, don't open Claude Code
 *   npm run claude -- --serve-only  start gateway only
 *   npm run claude -- --restart   stop whatever listens on the port, start fresh
 *   npm run claude -- --port 4000 --model groq/llama-3.3-70b-versatile
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, openSync } from "node:fs";
import os from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);

/* ─────────────────────────── config ─────────────────────────────── */

function readEnv() {
  const env = {};
  const file = path.join(ROOT, ".env");
  if (!existsSync(file)) return env;
  for (const line of require("node:fs").readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[m[1]] = value;
  }
  return env;
}

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i !== -1 ? args.splice(i, 1)[0] && true : false;
};
const flagValue = (name) => {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};

const CHECK = flag("--check");
const SERVE_ONLY = flag("--serve-only");
const RESTART = flag("--restart");
const REBUILD = flag("--rebuild");
const PORT_ARG = flagValue("--port");
const MODEL_ARG = flagValue("--model");
const SMALL_MODEL_ARG = flagValue("--small-model");

const dotenv = readEnv();
const PORT = Number(
  PORT_ARG ?? process.env.PORT ?? dotenv.PORT ?? 3000,
);
const API_KEY =
  process.env.PUBLIC_API_KEY ?? dotenv.PUBLIC_API_KEY ?? "nishan-bajagain";
const MODEL = MODEL_ARG ?? process.env.HAMRO_MODEL ?? "random";
const SMALL_MODEL =
  SMALL_MODEL_ARG ?? process.env.HAMRO_SMALL_MODEL ?? "groq/llama-3.3-70b-versatile";
const BASE_URL = `http://localhost:${PORT}`;
const LOG_FILE = path.join(ROOT, ".freebuff", "hamro-server.log");

/* ─────────────────────────── helpers ────────────────────────────── */

function log(msg) {
  console.log(msg);
}

function httpProbe(urlPath, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const url = new URL(urlPath, BASE_URL);
    const req = require("node:http").request(
      url,
      { method: "GET", timeout: timeoutMs },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(null));
    req.end();
  });
}

async function isUp() {
  return (await httpProbe("/api/health")) !== null;
}

/** True when the running gateway has the Anthropic /v1/messages endpoint. */
async function hasMessagesEndpoint() {
  return new Promise((resolve) => {
    const url = new URL("/v1/messages", BASE_URL);
    const body = JSON.stringify({
      model: "random",
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1,
    });
    const req = require("node:http").request(
      url,
      {
        method: "POST",
        timeout: 5000,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": "bad-key-probe",
          "content-length": Buffer.byteLength(body),
        },
      },
      (res) => {
        res.resume();
        // 401 (auth) or 400 (validation) ⇒ endpoint exists. 404 ⇒ old build.
        resolve(res.statusCode !== 404);
      },
    );
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(false));
    req.end(body);
  });
}

/** Best-effort: stop whatever process listens on the port. */
async function killPort(port) {
  const pids = [];
  try {
    if (process.platform === "win32") {
      const out = spawnSync("netstat", ["-ano"], { encoding: "utf8" });
      for (const line of out.stdout.split(/\r?\n/)) {
        if (line.includes(`:${port}`) && /LISTENING/i.test(line)) {
          const pid = line.trim().split(/\s+/).pop();
          if (pid && pid !== "0") pids.push(pid);
        }
      }
      for (const pid of pids) {
        spawnSync("taskkill", ["/PID", pid, "/F"], { stdio: "ignore" });
      }
    } else {
      for (const cmd of [
        ["lsof", ["-ti", `tcp:${port}`]],
        ["fuser", [`-k`, `${port}/tcp`]],
      ]) {
        const out = spawnSync(cmd[0], cmd[1], { encoding: "utf8" });
        if (out.status === 0 && out.stdout) {
          for (const pid of out.stdout.trim().split(/\s+/)) {
            if (pid && pid !== "0") {
              pids.push(pid);
              spawnSync("kill", [pid], { stdio: "ignore" });
            }
          }
          break;
        }
      }
    }
  } catch {
    /* best effort */
  }
  return pids;
}

function buildOnce() {
  const buildId = path.join(ROOT, ".next", "BUILD_ID");
  if (!REBUILD && existsSync(buildId)) return;
  log("  Building the gateway (first run — takes ~1 min)…");
  const r = spawnSync("npm", ["run", "build"], {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (r.status !== 0) {
    log("❌ Build failed. Fix the errors above and re-run.");
    process.exit(1);
  }
}

function startServer() {
  const nextBin = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
  const out = openSync(LOG_FILE, "a");
  const child = spawn(
    process.execPath,
    [nextBin, "start", "-p", String(PORT)],
    {
      cwd: ROOT,
      detached: true,
      stdio: ["ignore", out, out],
      env: { ...process.env, PORT: String(PORT) },
    },
  );
  child.unref();
  log(`  Gateway starting (pid ${child.pid}) → http://localhost:${PORT}`);
  log(`  Log: ${LOG_FILE}`);
}

async function ensureServer() {
  if (await isUp()) {
    const has = await hasMessagesEndpoint();
    if (has) {
      log(`✅ Gateway already running at ${BASE_URL}`);
      return true;
    }
    log(`⚠️  A server is running on port ${PORT} but it is an OLD build`);
    log(`   (no /v1/messages endpoint). Restart it with:`);
    log(`   npm run claude -- --restart`);
    return false;
  }

  log(`▶ Starting hamro.ai gateway on port ${PORT} …`);
  if (!existsSync(path.join(ROOT, "node_modules"))) {
    log("  Installing dependencies…");
    const r = spawnSync("npm", ["install"], {
      cwd: ROOT,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    if (r.status !== 0) {
      log("❌ npm install failed.");
      process.exit(1);
    }
  }
  buildOnce();
  startServer();

  // Wait up to 90s for the server to answer.
  for (let i = 0; i < 90; i++) {
    if (await isUp()) {
      log(`✅ Gateway is up at ${BASE_URL}`);
      return true;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  log(`❌ Gateway did not start within 90s — check ${LOG_FILE}`);
  return false;
}

const SETTINGS_FILE = path.join(ROOT, ".freebuff", "claude-settings.json");

/**
 * Claude Code's global `~/.claude/settings.json` `env` block overrides shell
 * environment variables, so exporting ANTHROPIC_* is not enough if the user
 * has a global provider configured there. Instead we hand Claude Code an
 * isolated settings file via `--settings` (merged over the user's own file so
 * theme/effortLevel etc. are preserved) that points it at this gateway. The
 * user's global config is never modified.
 */
function writeSettingsFile() {
  const userSettingsPath = path.join(os.homedir(), ".claude", "settings.json");
  let merged = {};
  try {
    if (existsSync(userSettingsPath)) {
      merged = JSON.parse(
        require("node:fs").readFileSync(userSettingsPath, "utf8"),
      );
    }
  } catch {
    merged = {};
  }
  merged.env = {
    ANTHROPIC_BASE_URL: BASE_URL,
    ANTHROPIC_AUTH_TOKEN: API_KEY,
    ANTHROPIC_API_KEY: "", // empty ⇒ unset; forces AUTH_TOKEN path
    ANTHROPIC_MODEL: MODEL,
    ANTHROPIC_SMALL_FAST_MODEL: SMALL_MODEL,
    ANTHROPIC_DEFAULT_OPUS_MODEL: MODEL,
    ANTHROPIC_DEFAULT_SONNET_MODEL: MODEL,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: SMALL_MODEL,
  };
  require("node:fs").mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  require("node:fs").writeFileSync(
    SETTINGS_FILE,
    JSON.stringify(merged, null, 2),
    "utf8",
  );
  return SETTINGS_FILE;
}

function report(settingsFile) {
  log("");
  log("────────────────────────── hamro.ai ──────────────────────────");
  log(`  Gateway             ${BASE_URL}`);
  log(`  API key             ${API_KEY.slice(0, 4)}…${API_KEY.slice(-4)}`);
  log(`  Claude Code model   ${MODEL}`);
  log(`  Background model    ${SMALL_MODEL}`);
  log(`  Isolated settings   ${settingsFile}`);
  log(`  (your global ~/.claude/settings.json is NOT modified)`);
  log("");
  log(
    `  Model mode: ${MODEL === "random"
      ? "“random” — a model is picked once per session and pinned (never switches on its own)"
      : MODEL}`,
  );
  log("──────────────────────────────────────────────────────────────");
}

/* ───────────────────────────── main ─────────────────────────────── */

async function main() {
  if (RESTART) {
    log(`Stopping whatever listens on port ${PORT}…`);
    const pids = await killPort(PORT);
    log(pids.length ? `  Stopped pid(s): ${pids.join(", ")}` : "  Nothing found on that port.");
    await new Promise((r) => setTimeout(r, 800));
  }

  const up = await ensureServer();
  if (!up) process.exit(1);

  const settingsFile = writeSettingsFile();
  report(settingsFile);
  if (CHECK || SERVE_ONLY) {
    log(CHECK ? "\n✅ All checks passed. Claude Code is ready to run." : "\n✅ Gateway is serving. Run `npm run claude` to open Claude Code.");
    process.exit(0);
  }

  const claudeEnv = {
    ...process.env,
    ANTHROPIC_BASE_URL: BASE_URL,
    ANTHROPIC_AUTH_TOKEN: API_KEY,
    ANTHROPIC_MODEL: MODEL,
    ANTHROPIC_SMALL_FAST_MODEL: SMALL_MODEL,
    ANTHROPIC_DEFAULT_OPUS_MODEL: MODEL,
    ANTHROPIC_DEFAULT_SONNET_MODEL: MODEL,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: SMALL_MODEL,
    // Stop Claude Code phoning home (statsig/telemetry) — keeps a custom
    // gateway session free of network noise and prompts.
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    // `random`/free models aren't in Claude Code's known-model table; don't
    // let the unknown-model context-window warning (or premature compaction)
    // interrupt the session.
    CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT: "1",
  };

  const claudeArgs = ["--settings", settingsFile, ...args];

  log(`\n🚀 Opening Claude Code (model: ${MODEL}) …\n`);
  const fail = (err) => {
    if (err.code === "ENOENT") {
      log("❌ `claude` was not found on PATH.");
      log("   Install it with:  npm install -g @anthropic-ai/claude-code");
      log("   (or https://claude.com/download — then reopen your terminal)");
    } else {
      log(`❌ Failed to launch Claude Code: ${err.message}`);
    }
    process.exit(1);
  };
  const child = spawn("claude", claudeArgs, {
    stdio: "inherit",
    shell: false,
    env: claudeEnv,
  });
  child.on("error", (err) => {
    if (err.code === "ENOENT" && process.platform === "win32") {
      // Some Windows installs expose `claude` only as a .cmd shim — retry
      // through the shell in that case.
      const retry = spawn("claude", claudeArgs, {
        stdio: "inherit",
        shell: true,
        env: claudeEnv,
      });
      retry.on("error", fail);
      retry.on("exit", (code) => process.exit(code ?? 0));
      return;
    }
    fail(err);
  });
  child.on("exit", (code) => process.exit(code ?? 0));
}

main().catch((e) => {
  console.error("Unexpected error:", e);
  process.exit(1);
});
