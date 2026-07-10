#!/usr/bin/env node
// launchd-hosted daemon for the OM Support Assistant Claude Code bridge.
//
// Listens on a unix socket; the browser-spawned native-messaging host
// (claude-bridge.js) relays frames here. Because THIS process is launched by
// launchd — not by the browser — the files `claude` extracts at runtime carry
// no com.apple.quarantine, which permanently kills the recurring Gatekeeper
// "ripgrep.node could not be verified" popup. Design adversarially reviewed
// 2026-07-10 (premise empirically confirmed). See bridge/README.md, DECISIONS D41.
//
// Protocol: identical 4-byte LE length-prefixed JSON frames as native messaging
// (frame-codec.js). Per-connection replies stay in request order; claude spawns
// are capped by a GLOBAL semaphore (concurrent connections must not fan out into
// unbounded `claude -p` processes / Enterprise-seat bursts).
// Zero npm dependencies — Node builtins only.

import { createServer, connect } from "node:net";
import { execFileSync } from "node:child_process";
import { mkdirSync, chmodSync, unlinkSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, isAbsolute } from "node:path";

import { encodeFrame, createFrameDecoder } from "./frame-codec.js";
import { createConfigReader, handleRequest } from "./bridge-core.js";
import { socketPath, daemonDir } from "./launchd.js";

const HERE = dirname(fileURLToPath(import.meta.url));

function log(...args) {
  process.stderr.write(`[bridge-daemon ${new Date().toISOString()}] ${args.join(" ")}\n`);
}

// Tiny FIFO semaphore — caps concurrent claude spawns across ALL connections.
export function createSemaphore(limit) {
  let active = 0;
  const waiters = [];
  return {
    async acquire() {
      if (active < limit) {
        active++;
        return;
      }
      await new Promise((resolve) => waiters.push(resolve));
    },
    release() {
      active--;
      const next = waiters.shift();
      if (next) {
        active++;
        next();
      }
    },
    waiting: () => waiters.length,
  };
}

// Testable server factory: transport + framing + ordering + concurrency cap,
// with the request handler injected (tests pass a fake; main passes bridge-core).
// handler(req, conn) -> reply object.
export function createBridgeServer({
  sockPath,
  handler,
  onLog = log,
  maxConcurrent = 2,
  maxQueued = 8,
}) {
  const sem = createSemaphore(maxConcurrent);

  // allowHalfOpen: the forwarder half-closes (FIN) after its last request; the
  // reply direction must stay open until we've written every reply.
  const server = createServer({ allowHalfOpen: true }, (conn) => {
    const decoder = createFrameDecoder();
    let replyChain = Promise.resolve(); // per-connection reply ordering
    let pending = 0;
    let clientEnded = false;

    const maybeEnd = () => {
      if (clientEnded && pending === 0 && !conn.destroyed) conn.end();
    };
    const writeReply = (reply) => {
      if (reply && !conn.destroyed) conn.write(encodeFrame(reply));
      pending--;
      maybeEnd();
    };

    conn.on("data", (chunk) => {
      let frames;
      try {
        frames = decoder.push(chunk);
      } catch (err) {
        // A poisoned decoder can never re-align — reply once and DESTROY.
        onLog(`frame decode error: ${err.message}`);
        if (!conn.destroyed) {
          conn.write(encodeFrame({ text: "", error: `frame decode error: ${err.message}` }));
        }
        conn.destroy();
        return;
      }
      for (const req of frames) {
        pending++;
        const isPing = !!(req && req.ping);
        // Pings NEVER wait on the semaphore: a health check queued behind two
        // long compose calls would time out and falsely mark the connector
        // unavailable (D38). They're also exempt from the busy refusal.
        if (!isPing && sem.waiting() >= maxQueued) {
          // Back-pressure: refuse instead of queueing unboundedly behind a
          // wedged claude.
          replyChain = replyChain.then(() =>
            writeReply({ text: "", error: "bridge daemon busy — try again shortly" })
          );
          continue;
        }
        const work = isPing
          ? Promise.resolve(handler(req, conn))
          : (async () => {
              await sem.acquire();
              try {
                if (conn.destroyed) return null; // client gone — don't spawn for nobody
                return await handler(req, conn);
              } finally {
                sem.release();
              }
            })();
        replyChain = replyChain.then(async () => {
          let reply;
          try {
            reply = await work;
          } catch (err) {
            reply = { text: "", error: `daemon error: ${err.message}` };
          }
          writeReply(reply);
        });
      }
    });

    conn.on("end", () => {
      clientEnded = true;
      // Under allowHalfOpen, a DEAD client delivers only 'end' ('close' would
      // wait for our reply write to EPIPE). The protocol makes this
      // unambiguous: the forwarder never half-closes while replies are still
      // owed (its maybeHalfClose requires inflight === 0). So 'end' with
      // pending > 0 means the client vanished — destroy so queued work skips
      // and per-request close-listeners kill any running child.
      if (pending > 0) {
        onLog("client vanished with replies pending — destroying connection");
        conn.destroy();
        return;
      }
      maybeEnd();
    });
    conn.on("error", (err) => onLog(`conn error: ${err.message}`));
  });
  server.on("error", (err) => onLog(`server error: ${err.message}`));

  return {
    server,
    listen: () =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(sockPath, () => {
          server.removeListener("error", reject);
          try {
            chmodSync(sockPath, 0o600); // same-user only (belt: umask already 077)
          } catch {
            /* best effort */
          }
          resolve();
        });
      }),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

// Is a live daemon already serving this socket? (vs a stale file from a crash)
function socketInUse(sockPath) {
  return new Promise((resolve) => {
    const probe = connect(sockPath);
    probe.once("connect", () => {
      probe.destroy();
      resolve(true);
    });
    probe.once("error", () => resolve(false));
  });
}

const REQUEST_TIMEOUT_MS = 180000; // generous: reason-mode compose runs 30-90s

async function main() {
  process.umask(0o077); // socket + any files born user-only

  // launchd does not reliably provide TMPDIR; without it claude extracts to
  // world-readable /tmp. Point it at the per-user temp dir like Terminal has.
  if (!process.env.TMPDIR) {
    try {
      const t = execFileSync("getconf", ["DARWIN_USER_TEMP_DIR"], { encoding: "utf8" }).trim();
      if (t) process.env.TMPDIR = t;
    } catch {
      /* fine — claude falls back to /tmp */
    }
  }

  const readConfig = createConfigReader(join(HERE, "config.json"), log);
  const boot = readConfig();

  // A bare "claude" works under a login shell but NOT under launchd's minimal
  // PATH. Refuse loudly; KeepAlive retries (throttled), so fixing config.json
  // self-heals without a manual kickstart.
  const bootBin = boot.claudeBin || "";
  if (!isAbsolute(bootBin) || !existsSync(bootBin)) {
    log(`fatal: config claudeBin must be an absolute existing path (got "${bootBin}"). Re-run bridge/install.js.`);
    process.exit(1);
  }

  const sockPath = process.env.OM_BRIDGE_SOCK || boot.sockPath || socketPath();
  if (sockPath.length > 100) {
    log(`fatal: socket path too long for sun_path (${sockPath.length} > 100): ${sockPath}`);
    process.exit(1);
  }

  mkdirSync(daemonDir(), { recursive: true, mode: 0o700 });

  if (existsSync(sockPath)) {
    if (await socketInUse(sockPath)) {
      // Another instance owns it. Exit cleanly — KeepAlive.SuccessfulExit=false
      // means launchd will NOT respawn us into a flap loop.
      log("another daemon already serves the socket; exiting");
      process.exit(0);
    }
    log("removing stale socket");
    try {
      unlinkSync(sockPath);
    } catch (err) {
      log(`could not unlink stale socket: ${err.message}`);
    }
  }

  const { listen } = createBridgeServer({
    sockPath,
    handler: (req, conn) => {
      const config = readConfig(); // mtime-fresh: config edits apply per request
      const ctx = { claudeBin: config.claudeBin || bootBin, kbRoot: config.kbRoot || null };
      if (req && req.ping) return handleRequest(req, ctx, { daemon: true });

      // Non-ping: enforce a wall-clock timeout and kill the child if the
      // requesting connection dies (nobody left to read the reply).
      //
      // CRITICAL invariant: this promise must ALWAYS settle, even if the
      // child's stdio never closes (SIGTERM-ignoring child, orphaned grandchild
      // holding the pipes). An unsettled promise never releases its global
      // semaphore slot — two of those and the daemon is wedged for months.
      return new Promise((resolve) => {
        let child = null;
        let settled = false;
        const settle = (reply) => {
          if (settled) return;
          settled = true;
          clearTimeout(termTimer);
          clearTimeout(killTimer);
          conn.removeListener("close", onGone);
          resolve(reply);
        };
        // Kill the whole process GROUP (detached spawn): SIGTERM first, then
        // SIGKILL — a lone child.kill leaves grandchildren holding the pipes.
        const killGroup = (sig) => {
          if (!child) return;
          try {
            process.kill(-child.pid, sig);
          } catch {
            try {
              child.kill(sig);
            } catch {
              /* already gone */
            }
          }
        };
        let killTimer = null;
        const onGone = () => {
          killGroup("SIGTERM");
          killTimer = setTimeout(() => {
            killGroup("SIGKILL");
            // Free the slot even if stdio never closes.
            settle({ text: "", error: "claude run aborted (client disconnected)" });
          }, 5000);
        };
        const termTimer = setTimeout(() => {
          log("request timeout — killing claude child group");
          killGroup("SIGTERM");
          killTimer = setTimeout(() => {
            killGroup("SIGKILL");
            settle({ text: "", error: `claude run timed out after ${REQUEST_TIMEOUT_MS / 1000}s` });
          }, 5000);
        }, REQUEST_TIMEOUT_MS);
        conn.once("close", onGone);
        handleRequest(req, ctx, {}, { onChild: (c) => (child = c), detached: true }).then(settle);
      });
    },
  });
  await listen();
  log(`listening on ${sockPath} (claude: ${bootBin}, kb: ${boot.kbRoot || "none"})`);

  const shutdown = () => {
    try {
      unlinkSync(sockPath);
    } catch {
      /* already gone */
    }
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

// Only auto-start when executed directly (not when imported by tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    log(`fatal: ${err.stack || err.message}`);
    process.exit(1);
  });
}
