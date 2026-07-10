import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { callClaudeCode, pingClaudeCode } from "../../providers/claude-code.js";

const HOST = "com.optinmonster.claude_bridge";

// Drive chrome.runtime.sendNativeMessage's callback form. `impl(message)` returns
// either { response } (delivered to the callback) or { lastError } (sets
// chrome.runtime.lastError and delivers undefined, as Chrome does on failure).
function mockNative(impl) {
  chrome.runtime.sendNativeMessage = (host, message, cb) => {
    expect(host).toBe(HOST);
    const { response, lastError } = impl(message);
    chrome.runtime.lastError = lastError || null;
    cb(response);
    chrome.runtime.lastError = null;
  };
}

afterEach(() => {
  chrome.runtime.lastError = null;
});

describe("callClaudeCode", () => {
  it("returns the bridge's text on success", async () => {
    let sent;
    mockNative((msg) => {
      sent = msg;
      return { response: { text: "polished", mode: "transform" } };
    });
    const out = await callClaudeCode({ system: "s", user: "u", model: "m", mode: "transform" });
    expect(out).toEqual({ text: "polished" });
    expect(sent).toEqual({ system: "s", user: "u", model: "m", mode: "transform" });
  });

  it("maps chrome.runtime.lastError to an error result", async () => {
    mockNative(() => ({ lastError: { message: "Specified native messaging host not found." } }));
    const out = await callClaudeCode({ system: "s", user: "u" });
    expect(out.text).toBe("");
    expect(out.error).toMatch(/bridge unavailable.*not found/i);
  });

  it("treats an absent response as an error", async () => {
    mockNative(() => ({ response: undefined }));
    const out = await callClaudeCode({ system: "s", user: "u" });
    expect(out.text).toBe("");
    expect(out.error).toMatch(/no response/i);
  });

  it("surfaces a bridge-reported error frame", async () => {
    mockNative(() => ({ response: { text: "", error: "claude exited 1: not logged in" } }));
    const out = await callClaudeCode({ system: "s", user: "u" });
    expect(out).toEqual({ text: "", error: "claude exited 1: not logged in" });
  });

  it("does not throw if sendNativeMessage throws synchronously", async () => {
    chrome.runtime.sendNativeMessage = () => {
      throw new Error("native messaging API missing");
    };
    const out = await callClaudeCode({ system: "s", user: "u" });
    expect(out.text).toBe("");
    expect(out.error).toMatch(/native messaging API missing/);
  });
});

describe("pingClaudeCode", () => {
  it("reports ok + kb on a pong", async () => {
    let sent;
    mockNative((msg) => {
      sent = msg;
      return { response: { pong: true, ok: true, kb: true } };
    });
    const out = await pingClaudeCode();
    expect(out).toEqual({ ok: true, kb: true });
    expect(sent).toEqual({ ping: true });
  });

  it("reports kb:false when the bridge has no KB folder", async () => {
    mockNative(() => ({ response: { pong: true, ok: true, kb: false } }));
    expect(await pingClaudeCode()).toEqual({ ok: true, kb: false });
  });

  it("reports not-ok on lastError", async () => {
    mockNative(() => ({ lastError: { message: "host not found" } }));
    const out = await pingClaudeCode();
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/host not found/);
  });

  it("reports not-ok when there is no pong", async () => {
    mockNative(() => ({ response: {} }));
    const out = await pingClaudeCode();
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/no pong/i);
  });
});
