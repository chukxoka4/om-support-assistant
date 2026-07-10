// Integration test of the daemon's socket transport: real unix socket, real
// framing, injected (fake) request handler — no launchd, no claude.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { connect } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createBridgeServer } from "../../bridge/bridge-daemon.js";
import { encodeFrame, createFrameDecoder } from "../../bridge/frame-codec.js";

let dir;
let sockPath;
let srv;

function client(path) {
  const sock = connect(path);
  const decoder = createFrameDecoder();
  const replies = [];
  const waiters = [];
  sock.on("data", (chunk) => {
    for (const frame of decoder.push(chunk)) {
      const w = waiters.shift();
      if (w) w(frame);
      else replies.push(frame);
    }
  });
  return {
    sock,
    send: (obj) => sock.write(encodeFrame(obj)),
    next: () =>
      replies.length
        ? Promise.resolve(replies.shift())
        : new Promise((resolve) => waiters.push(resolve)),
    end: () => sock.end(),
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "om-bridge-test-"));
  sockPath = join(dir, "t.sock");
});

afterEach(async () => {
  if (srv) await srv.close().catch(() => {});
  srv = null;
  rmSync(dir, { recursive: true, force: true });
});

describe("createBridgeServer", () => {
  it("answers a framed ping through a real unix socket", async () => {
    srv = createBridgeServer({
      sockPath,
      onLog: () => {},
      handler: async (req) => (req.ping ? { pong: true, ok: true, kb: false, daemon: true } : { text: "" }),
    });
    await srv.listen();
    const c = client(sockPath);
    c.send({ ping: true });
    expect(await c.next()).toEqual({ pong: true, ok: true, kb: false, daemon: true });
    c.end();
  });

  it("serves multiple frames on one connection FIFO, even when the first is slower", async () => {
    srv = createBridgeServer({
      sockPath,
      onLog: () => {},
      handler: async (req) => {
        if (req.user === "slow") await new Promise((r) => setTimeout(r, 80));
        return { text: `done:${req.user}` };
      },
    });
    await srv.listen();
    const c = client(sockPath);
    c.send({ system: "s", user: "slow" });
    c.send({ system: "s", user: "fast" });
    expect((await c.next()).text).toBe("done:slow"); // FIFO despite being slower
    expect((await c.next()).text).toBe("done:fast");
    c.end();
  });

  it("handles concurrent connections independently", async () => {
    srv = createBridgeServer({
      sockPath,
      onLog: () => {},
      handler: async (req) => {
        if (req.user === "a") await new Promise((r) => setTimeout(r, 60));
        return { text: req.user };
      },
    });
    await srv.listen();
    const a = client(sockPath);
    const b = client(sockPath);
    a.send({ system: "s", user: "a" });
    b.send({ system: "s", user: "b" });
    // b must NOT wait for a's slow request (parallel across connections).
    expect((await b.next()).text).toBe("b");
    expect((await a.next()).text).toBe("a");
    a.end();
    b.end();
  });

  it("converts a handler exception into a framed error instead of dropping the connection", async () => {
    srv = createBridgeServer({
      sockPath,
      onLog: () => {},
      handler: async () => {
        throw new Error("boom");
      },
    });
    await srv.listen();
    const c = client(sockPath);
    c.send({ system: "s", user: "u" });
    const reply = await c.next();
    expect(reply.text).toBe("");
    expect(reply.error).toMatch(/daemon error: boom/);
    c.end();
  });

  it("replies with a framed error on an undecodable frame, then destroys the connection", async () => {
    srv = createBridgeServer({
      sockPath,
      onLog: () => {},
      handler: async () => ({ text: "never" }),
    });
    await srv.listen();
    const c = client(sockPath);
    // Length prefix far beyond MAX_FRAME_BYTES -> decoder throws.
    const evil = Buffer.alloc(4);
    evil.writeUInt32LE(0xffffffff, 0);
    c.sock.write(evil);
    const reply = await c.next();
    expect(reply.error).toMatch(/frame decode error/);
    // The poisoned connection must be closed (a thrown decoder never re-aligns).
    await new Promise((resolve) => c.sock.once("close", resolve));
  });

  it("caps concurrent handler runs with the global semaphore", async () => {
    let running = 0;
    let peak = 0;
    srv = createBridgeServer({
      sockPath,
      onLog: () => {},
      maxConcurrent: 2,
      handler: async (req) => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 40));
        running--;
        return { text: req.user };
      },
    });
    await srv.listen();
    const clients = ["a", "b", "c", "d", "e"].map((u) => {
      const c = client(sockPath);
      c.send({ system: "s", user: u });
      return c;
    });
    const replies = await Promise.all(clients.map((c) => c.next()));
    expect(replies.map((r) => r.text).sort()).toEqual(["a", "b", "c", "d", "e"]);
    expect(peak).toBeLessThanOrEqual(2); // never more than maxConcurrent at once
    clients.forEach((c) => c.end());
  });

  it("refuses with a busy error when the queue cap is exceeded", async () => {
    srv = createBridgeServer({
      sockPath,
      onLog: () => {},
      maxConcurrent: 1,
      maxQueued: 1,
      handler: async (req) => {
        await new Promise((r) => setTimeout(r, 100));
        return { text: req.user };
      },
    });
    await srv.listen();
    // 1 running + 1 queued allowed; the 4th and 5th must be refused fast.
    const clients = ["a", "b", "c", "d", "e"].map((u) => {
      const c = client(sockPath);
      c.send({ system: "s", user: u });
      return c;
    });
    const replies = await Promise.all(clients.map((c) => c.next()));
    const busy = replies.filter((r) => /busy/.test(r.error || ""));
    const served = replies.filter((r) => r.text);
    expect(busy.length).toBeGreaterThanOrEqual(1);
    expect(served.length + busy.length).toBe(5);
    clients.forEach((c) => c.end());
  });

  it("skips the spawn when the requesting connection died while queued", async () => {
    const handled = [];
    srv = createBridgeServer({
      sockPath,
      onLog: () => {},
      maxConcurrent: 1,
      handler: async (req) => {
        handled.push(req.user);
        await new Promise((r) => setTimeout(r, 60));
        return { text: req.user };
      },
    });
    await srv.listen();
    const a = client(sockPath);
    a.send({ system: "s", user: "long" }); // occupies the semaphore
    await new Promise((r) => setTimeout(r, 10));
    const b = client(sockPath);
    b.send({ system: "s", user: "doomed" }); // queued behind a
    // The frame must actually REACH the daemon before the client dies —
    // destroying synchronously would discard it client-side and prove nothing.
    await new Promise((r) => setTimeout(r, 20));
    b.sock.destroy(); // client vanishes before its turn
    expect((await a.next()).text).toBe("long");
    await new Promise((r) => setTimeout(r, 80));
    expect(handled).toEqual(["long"]); // "doomed" was never handled
    a.end();
  });

  it("detects a dead client via 'end' with replies pending (allowHalfOpen)", async () => {
    // A dead client delivers only FIN ('end') under allowHalfOpen — 'close'
    // would wait until our reply write EPIPEs. 'end' with pending>0 must be
    // treated as client death: destroy, so close-listeners (child kill) fire.
    let sawClose = false;
    srv = createBridgeServer({
      sockPath,
      onLog: () => {},
      handler: async (req, conn) => {
        conn.once("close", () => (sawClose = true));
        await new Promise((r) => setTimeout(r, 100));
        return { text: "too late" };
      },
    });
    await srv.listen();
    const c = client(sockPath);
    c.send({ system: "s", user: "u" });
    await new Promise((r) => setTimeout(r, 20)); // frame delivered, handler running
    c.sock.end(); // polite FIN while a reply is still owed = vanished client
    await new Promise((r) => setTimeout(r, 40));
    expect(sawClose).toBe(true); // daemon destroyed the conn well before the reply
  });
});
