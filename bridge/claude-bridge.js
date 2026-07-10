#!/usr/bin/env node
// Chrome native-messaging host for the OM Support Assistant.
//
// Turns framed { system, user, model?, mode? } requests from the extension into
// { text } / { text: "", error } replies by spawning the locally-installed
// Claude Code CLI (`claude -p`), which authenticates with the agent's Claude
// Enterprise seat (claude.ai OAuth) — NOT an API key. Customer ticket text
// therefore reaches only Anthropic, under Awesome Motive's Enterprise terms.
//
// Zero npm dependencies — Node builtins only. Runs OUTSIDE the extension bundle
// (registered as a native-messaging host; see install.sh / README.md).
//
// Protocol: 4-byte little-endian length prefix + UTF-8 JSON, both directions
// (see frame-codec.js). Anything the host prints to stdout MUST be a frame, so
// all diagnostics go to stderr.

import { spawn } from "node:child_process";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir, userInfo } from "node:os";

import { encodeFrame, createFrameDecoder } from "./frame-codec.js";
import { buildClaudeInvocation, buildChildEnv } from "./build-args.js";

const HERE = dirname(fileURLToPath(import.meta.url));

function log(...args) {
  // stderr only — stdout is reserved for the native-messaging frame stream.
  process.stderr.write(`[claude-bridge] ${args.join(" ")}\n`);
}

// --- machine-local config (never travels in the extension / chrome.storage) ---
function loadConfig() {
  const path = join(HERE, "config.json");
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    log(`config.json unreadable: ${err.message}`);
    return {};
  }
}

const config = loadConfig();
const CLAUDE_BIN = config.claudeBin || "claude";
const KB_ROOT = config.kbRoot || null;

function kbAvailable() {
  if (!KB_ROOT) return false;
  try {
    return statSync(KB_ROOT).isDirectory();
  } catch {
    return false;
  }
}

// --- spawn one `claude -p` call and resolve to a reply object -----------------
function runClaude({ system, user, model, mode }) {
  return new Promise((resolve) => {
    const { args, cwd, effectiveMode } = buildClaudeInvocation({
      system,
      model,
      mode,
      kbRoot: KB_ROOT,
      kbAvailable: kbAvailable(),
      transformCwd: tmpdir(),
    });

    // Force the Enterprise-seat OAuth path, defuse the nested-session guard, and
    // backfill the identity/PATH vars claude needs when Chrome's env is sparse.
    let safeUser = {};
    try {
      safeUser = userInfo();
    } catch {
      /* userInfo can throw if /etc/passwd lookup fails; backfill is best-effort */
    }
    const env = buildChildEnv(process.env, { userInfo: safeUser, claudeBin: CLAUDE_BIN });

    let child;
    try {
      child = spawn(CLAUDE_BIN, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    } catch (err) {
      resolve({ text: "", error: `spawn failed: ${err.message}` });
      return;
    }

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));

    child.on("error", (err) => {
      const hint =
        err.code === "ENOENT"
          ? ` (is '${CLAUDE_BIN}' on PATH? set "claudeBin" in bridge/config.json)`
          : "";
      resolve({ text: "", error: `claude not launchable: ${err.message}${hint}` });
    });

    child.on("close", (code) => {
      if (code !== 0 && !stdout) {
        resolve({ text: "", error: `claude exited ${code}: ${stderr.trim().slice(0, 500)}` });
        return;
      }
      try {
        const result = JSON.parse(stdout);
        if (result.is_error || result.subtype !== "success") {
          resolve({ text: "", error: `claude: ${result.subtype || "error"} — ${stderr.trim().slice(0, 300)}` });
          return;
        }
        resolve({ text: result.result ?? "", mode: effectiveMode });
      } catch (err) {
        resolve({ text: "", error: `unparseable claude output: ${err.message}` });
      }
    });

    // User content goes via stdin, not argv.
    child.stdin.write(String(user ?? ""));
    child.stdin.end();
  });
}

// --- request dispatch ---------------------------------------------------------
async function handleRequest(req) {
  if (req && req.ping) {
    return { pong: true, ok: true, kb: kbAvailable() };
  }
  if (!req || typeof req.system !== "string" || typeof req.user !== "string") {
    return { text: "", error: "bad request: expected { system, user } strings" };
  }
  return runClaude(req);
}

// --- native-messaging stdio loop ---------------------------------------------
// Serialise requests so replies stay ordered (matters once Slice 7 switches to
// a long-lived connectNative port; harmless for one-shot sendNativeMessage).
const decoder = createFrameDecoder();
let queue = Promise.resolve();

function enqueue(req) {
  queue = queue.then(async () => {
    let reply;
    try {
      reply = await handleRequest(req);
    } catch (err) {
      reply = { text: "", error: `bridge error: ${err.message}` };
    }
    process.stdout.write(encodeFrame(reply));
  });
}

process.stdin.on("data", (chunk) => {
  let frames;
  try {
    frames = decoder.push(chunk);
  } catch (err) {
    log(`frame decode error: ${err.message}`);
    process.stdout.write(encodeFrame({ text: "", error: `frame decode error: ${err.message}` }));
    return;
  }
  for (const req of frames) enqueue(req);
});

process.stdin.on("end", () => {
  // Let the queued work drain, then exit (one-shot sendNativeMessage path).
  queue.then(() => process.exit(0));
});
