// Integration test of the full forwarder chain: spawn the REAL native host
// (claude-bridge.js) as a child process, point it at a fake daemon socket via
// OM_BRIDGE_SOCK, and drive framed requests through its stdio — exactly what
// Chrome does. Also proves the silent direct-mode fallback when no daemon is up
// (fallback then needs a real `claude`, so we only assert it doesn't hang and
// still speaks frames on a ping-shaped bad request).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createBridgeServer } from "../../bridge/bridge-daemon.js";
import { encodeFrame, createFrameDecoder } from "../../bridge/frame-codec.js";

const HOST = join(process.cwd(), "bridge", "claude-bridge.js");

let dir;
let sockPath;
let srv;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "om-fwd-test-"));
  sockPath = join(dir, "d.sock");
});

afterEach(async () => {
  if (srv) await srv.close().catch(() => {});
  srv = null;
  rmSync(dir, { recursive: true, force: true });
});

function driveHost({ env, frames }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOST], {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const decoder = createFrameDecoder();
    const replies = [];
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`host timed out; stderr: ${stderr}`));
    }, 8000);
    child.stdout.on("data", (chunk) => {
      for (const f of decoder.push(chunk)) {
        replies.push(f);
        if (replies.length === frames.length) {
          clearTimeout(timer);
          child.kill();
          resolve({ replies, stderr });
        }
      }
    });
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    for (const f of frames) child.stdin.write(encodeFrame(f));
  });
}

describe("claude-bridge.js forwarder", () => {
  it("relays frames to the daemon socket and returns its replies (daemon:true)", async () => {
    srv = createBridgeServer({
      sockPath,
      onLog: () => {},
      handler: async (req) =>
        req.ping ? { pong: true, ok: true, kb: true, daemon: true } : { text: `via-daemon:${req.user}`, mode: req.mode || "transform" },
    });
    await srv.listen();

    const { replies } = await driveHost({
      env: { OM_BRIDGE_SOCK: sockPath },
      frames: [{ ping: true }, { system: "s", user: "hello", mode: "transform" }],
    });
    expect(replies[0]).toEqual({ pong: true, ok: true, kb: true, daemon: true });
    expect(replies[1]).toEqual({ text: "via-daemon:hello", mode: "transform" });
  });

  it("falls back to direct mode when the daemon socket does not exist", async () => {
    // No server on sockPath. Direct mode answers pings itself (daemon:false) —
    // that needs no `claude`, so it's a clean fallback probe.
    const { replies, stderr } = await driveHost({
      env: { OM_BRIDGE_SOCK: join(dir, "missing.sock") },
      frames: [{ ping: true }],
    });
    expect(replies[0].pong).toBe(true);
    expect(replies[0].daemon).toBe(false);
    expect(stderr).toMatch(/daemon unreachable/);
  });

  it("emits a framed 'connection lost' error (not a hang) when the daemon dies mid-request", async () => {
    // Fake daemon: accept, read the request, then die without replying.
    const { createServer } = await import("node:net");
    const evil = createServer({ allowHalfOpen: true }, (conn) => {
      conn.on("data", () => setTimeout(() => conn.destroy(), 20));
    });
    await new Promise((r) => evil.listen(sockPath, r));

    const { replies } = await driveHost({
      env: { OM_BRIDGE_SOCK: sockPath },
      frames: [{ system: "s", user: "will-be-orphaned" }],
    });
    expect(replies[0].text).toBe("");
    expect(replies[0].error).toMatch(/daemon connection lost/);
    await new Promise((r) => evil.close(r));
  });

  it("retries ECONNREFUSED (login race: stale socket file, daemon starting late)", async () => {
    // Create a genuinely stale socket file: a throwaway process binds it and is
    // SIGKILLed (no cleanup) — exactly what a reboot leaves behind.
    const { execFileSync } = await import("node:child_process");
    const { existsSync } = await import("node:fs");
    try {
      execFileSync(process.execPath, [
        "-e",
        `const net=require('net');const s=net.createServer();s.listen(process.argv[1],()=>{process.kill(process.pid,'SIGKILL')});`,
        sockPath,
      ]);
    } catch {
      /* the child SIGKILLs itself by design — execFileSync reports that as an error */
    }
    expect(existsSync(sockPath)).toBe(true); // the stale socket file is in place
    // Start the real daemon ~500ms AFTER the forwarder begins connecting.
    setTimeout(async () => {
      const { unlinkSync } = await import("node:fs");
      try { unlinkSync(sockPath); } catch {}
      srv = createBridgeServer({
        sockPath,
        onLog: () => {},
        handler: async () => ({ pong: true, ok: true, kb: false, daemon: true }),
      });
      await srv.listen();
    }, 500);

    const { replies } = await driveHost({
      env: { OM_BRIDGE_SOCK: sockPath },
      frames: [{ ping: true }],
    });
    // Reached the daemon via retry — NOT the direct fallback.
    expect(replies[0].daemon).toBe(true);
  });

  it("keeps byte-perfect framing for large multi-frame payloads through the relay", async () => {
    srv = createBridgeServer({
      sockPath,
      onLog: () => {},
      handler: async (req) => ({ text: req.user.length + ":" + req.user.slice(0, 8) }),
    });
    await srv.listen();

    const big = "x".repeat(300_000); // ~300KB — larger than one pipe buffer
    const { replies } = await driveHost({
      env: { OM_BRIDGE_SOCK: sockPath },
      frames: [
        { system: "s", user: big },
        { system: "s", user: "tiny" },
      ],
    });
    expect(replies[0].text).toBe(`300000:xxxxxxxx`);
    expect(replies[1].text).toBe("4:tiny");
  });
});
