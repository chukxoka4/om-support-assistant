// Shared request-handling core for the Claude Code bridge. Used by BOTH
// claude-bridge.js (the native-messaging host, direct mode) and
// bridge-daemon.js (the launchd helper). Node builtins only.
//
// One request in ({ ping } | { system, user, model?, mode? }), one reply out
// ({ pong,... } | { text,... } | { text:"", error }). No transport knowledge —
// callers own stdio/sockets and framing.

import { spawn } from "node:child_process";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";

import { buildClaudeInvocation, buildChildEnv } from "./build-args.js";

// --- machine-local config (never travels in the extension / chrome.storage) ---
export function loadConfig(configPath, log = () => {}) {
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, "utf8"));
  } catch (err) {
    log(`config.json unreadable: ${err.message}`);
    return {};
  }
}

// mtime-cached config reader for long-lived processes (the daemon): edits to
// config.json take effect on the next request, no restart needed.
export function createConfigReader(configPath, log = () => {}) {
  let cached = { mtimeMs: -1, config: {} };
  return () => {
    let mtimeMs = 0;
    try {
      mtimeMs = statSync(configPath).mtimeMs;
    } catch {
      mtimeMs = 0; // missing file -> defaults
    }
    if (mtimeMs !== cached.mtimeMs) {
      cached = { mtimeMs, config: loadConfig(configPath, log) };
    }
    return cached.config;
  };
}

export function kbAvailable(kbRoot) {
  if (!kbRoot) return false;
  try {
    return statSync(kbRoot).isDirectory();
  } catch {
    return false;
  }
}

// Deeper probe for ping replies: a launchd agent is its own TCC "responsible
// process", so a KB under Documents/Desktop/iCloud can be stat-able yet
// unreadable from the daemon. readdir proves Grep/Read will actually work.
export function kbReadable(kbRoot) {
  if (!kbAvailable(kbRoot)) return false;
  try {
    readdirSync(kbRoot);
    return true;
  } catch {
    return false;
  }
}

// --- spawn one `claude -p` call and resolve to a reply object -----------------
// opts.onChild receives the ChildProcess so long-lived callers (the daemon) can
// enforce timeouts and kill orphans when the requesting connection dies.
export function runClaude({ system, user, model, mode }, { claudeBin, kbRoot }, opts = {}) {
  return new Promise((resolve) => {
    const { args, cwd, effectiveMode } = buildClaudeInvocation({
      system,
      model,
      mode,
      kbRoot,
      kbAvailable: kbAvailable(kbRoot),
      transformCwd: tmpdir(),
    });

    // Force the Enterprise-seat OAuth path, defuse the nested-session guard, and
    // backfill the identity/PATH vars claude needs when the parent env is sparse
    // (Chrome-spawned hosts AND launchd agents both have minimal environments).
    let safeUser = {};
    try {
      safeUser = userInfo();
    } catch {
      /* userInfo can throw if /etc/passwd lookup fails; backfill is best-effort */
    }
    const env = buildChildEnv(process.env, { userInfo: safeUser, claudeBin });

    let child;
    try {
      child = spawn(claudeBin, args, {
        cwd,
        env,
        stdio: ["pipe", "pipe", "pipe"],
        // detached lets a long-lived caller (the daemon) SIGKILL the whole
        // process GROUP — otherwise an orphaned grandchild holding the stdio
        // pipes defers 'close' forever.
        detached: !!opts.detached,
      });
    } catch (err) {
      resolve({ text: "", error: `spawn failed: ${err.message}` });
      return;
    }
    if (opts.onChild) opts.onChild(child);

    // If claude exits before draining stdin (not logged in, bad flag), the
    // pending write EPIPEs. Without this listener that's an uncaught stream
    // error — fatal for the months-lived daemon process.
    child.stdin.on("error", () => {});

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));

    child.on("error", (err) => {
      const hint =
        err.code === "ENOENT"
          ? ` (is '${claudeBin}' on PATH? set "claudeBin" in bridge/config.json)`
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
// `extra` is merged into ping replies (e.g. { daemon: true } so callers can tell
// which transport served them).
export async function handleRequest(req, { claudeBin, kbRoot }, extra = {}, opts = {}) {
  if (req && req.ping) {
    // kb means "reason mode will actually work": present AND readable (a
    // launchd agent can hit TCC denials a terminal never sees).
    return { pong: true, ok: true, kb: kbReadable(kbRoot), ...extra };
  }
  if (!req || typeof req.system !== "string" || typeof req.user !== "string") {
    return { text: "", error: "bad request: expected { system, user } strings" };
  }
  return runClaude(req, { claudeBin, kbRoot }, opts);
}
