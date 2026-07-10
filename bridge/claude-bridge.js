#!/usr/bin/env node
// Chrome native-messaging host for the OM Support Assistant.
//
// Turns framed { system, user, model?, mode? } requests from the extension into
// { text } / { text: "", error } replies. Two transports, decided at startup:
//
//   1. FORWARD (preferred, macOS): relay to the launchd bridge daemon over a
//      unix socket. The daemon — not the browser — spawns `claude`, so the
//      files claude extracts are NEVER quarantined by Gatekeeper (the
//      "ripgrep.node could not be verified" popup). See bridge/README.md.
//   2. DIRECT (fallback): spawn `claude -p` in-process, exactly the original
//      behavior. Used when the daemon isn't installed/running (Linux/Windows,
//      or a teammate who skipped the daemon step).
//
// The relay DECODES and RE-ENCODES frames (never raw byte piping): only whole
// frames ever reach stdout, so a daemon crash mid-reply yields a clean framed
// error instead of a corrupted native-messaging stream or a hung extension.
//
// Zero npm dependencies — Node builtins only. Runs OUTSIDE the extension bundle.
// Anything printed to stdout MUST be a frame, so all diagnostics go to stderr.

import { connect } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { encodeFrame, createFrameDecoder } from "./frame-codec.js";
import { loadConfig, handleRequest } from "./bridge-core.js";
import { socketPath } from "./launchd.js";

const HERE = dirname(fileURLToPath(import.meta.url));

function log(...args) {
  // stderr only — stdout is reserved for the native-messaging frame stream.
  process.stderr.write(`[claude-bridge] ${args.join(" ")}\n`);
}

const config = loadConfig(join(HERE, "config.json"), log);
const CLAUDE_BIN = config.claudeBin || "claude";
const KB_ROOT = config.kbRoot || null;
// Test/override hook; config may also pin it. Defaults to the launchd daemon's.
const SOCK = process.env.OM_BRIDGE_SOCK || config.sockPath || socketPath();

// Chrome killed us (extension reload / sendNativeMessage settled): exit quietly.
process.stdout.on("error", (err) => {
  if (err.code === "EPIPE") process.exit(0);
  log(`stdout error: ${err.message}`);
  process.exit(1);
});

function writeReply(obj) {
  try {
    process.stdout.write(encodeFrame(obj));
  } catch {
    /* stdout error handler owns this */
  }
}

// process.exit() does not flush a pending async pipe write — a large reply
// could be truncated mid-frame. Gate exit on drain.
function exitWhenDrained(code) {
  if (process.stdout.writableLength === 0) process.exit(code);
  else process.stdout.once("drain", () => process.exit(code));
}

// --- transport 2: direct (the original in-process behavior) -------------------
function startDirectMode() {
  const decoder = createFrameDecoder();
  let queue = Promise.resolve();
  let poisoned = false;

  const enqueue = (req) => {
    queue = queue.then(async () => {
      let reply;
      try {
        reply = await handleRequest(req, { claudeBin: CLAUDE_BIN, kbRoot: KB_ROOT }, { daemon: false });
      } catch (err) {
        reply = { text: "", error: `bridge error: ${err.message}` };
      }
      writeReply(reply);
    });
  };

  process.stdin.on("data", (chunk) => {
    if (poisoned) return;
    let frames;
    try {
      frames = decoder.push(chunk);
    } catch (err) {
      // A thrown decoder never re-aligns — reply once, stop consuming, exit.
      poisoned = true;
      log(`frame decode error: ${err.message}`);
      writeReply({ text: "", error: `frame decode error: ${err.message}` });
      queue.then(() => exitWhenDrained(1));
      return;
    }
    for (const req of frames) enqueue(req);
  });

  process.stdin.on("end", () => {
    // Let the queued work drain, then exit (one-shot sendNativeMessage path).
    queue.then(() => exitWhenDrained(0));
  });
}

// --- transport 1: forward to the launchd daemon --------------------------------
// Retry ECONNREFUSED briefly: at login, Chrome session-restore can race the
// daemon's startup, and falling back then would spawn claude under the browser
// — producing exactly the Gatekeeper popup this design exists to kill. ENOENT
// (socket file absent = daemon never installed) falls back immediately so
// non-daemon machines pay zero latency.
const CONNECT_RETRIES = 6;
const CONNECT_RETRY_MS = 300;

function startForwardMode(attempt = 0) {
  const sock = connect(SOCK);
  let connected = false;

  sock.once("connect", () => {
    connected = true;
    runRelay(sock);
  });

  sock.once("error", (err) => {
    if (connected) return; // runRelay owns post-connect errors
    sock.destroy();
    if (err.code === "ECONNREFUSED" && attempt < CONNECT_RETRIES) {
      setTimeout(() => startForwardMode(attempt + 1), CONNECT_RETRY_MS);
      return;
    }
    log(`daemon unreachable (${err.code || err.message}); using direct mode`);
    startDirectMode();
  });
}

function runRelay(sock) {
  const stdinDecoder = createFrameDecoder(); // stdin  -> requests
  const sockDecoder = createFrameDecoder(); // socket -> replies
  let inflight = 0; // requests sent, replies not yet received
  let stdinEnded = false;
  let poisoned = false;

  // Half-close our write side once every request is answered; the daemon
  // (allowHalfOpen) keeps the reply direction open until then.
  const maybeHalfClose = () => {
    if (stdinEnded && inflight === 0 && !sock.destroyed) sock.end();
  };

  process.stdin.on("data", (chunk) => {
    if (poisoned) return;
    let frames;
    try {
      frames = stdinDecoder.push(chunk);
    } catch (err) {
      poisoned = true;
      log(`frame decode error from browser: ${err.message}`);
      writeReply({ text: "", error: `frame decode error: ${err.message}` });
      sock.destroy();
      exitWhenDrained(1);
      return;
    }
    for (const req of frames) {
      inflight++;
      sock.write(encodeFrame(req));
    }
  });
  process.stdin.on("end", () => {
    stdinEnded = true;
    maybeHalfClose();
  });

  sock.on("data", (chunk) => {
    let frames;
    try {
      frames = sockDecoder.push(chunk);
    } catch (err) {
      // Daemon sent garbage — fail every pending request cleanly and die.
      log(`daemon protocol error: ${err.message}`);
      while (inflight > 0) {
        inflight--;
        writeReply({ text: "", error: "claude-code bridge daemon protocol error" });
      }
      sock.destroy();
      exitWhenDrained(1);
      return;
    }
    for (const reply of frames) {
      if (inflight > 0) inflight--;
      writeReply(reply);
    }
    maybeHalfClose();
  });

  sock.on("error", (err) => log(`daemon socket error: ${err.message}`));
  sock.on("close", () => {
    // Daemon died mid-request: resolve every pending call with a framed error
    // so the extension's sendNativeMessage settles instead of hanging.
    while (inflight > 0) {
      inflight--;
      writeReply({ text: "", error: "claude-code bridge daemon connection lost" });
    }
    exitWhenDrained(0);
  });
}

startForwardMode();
