import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { callLLM } from "../../providers/index.js";
import { setApiKeys, setClaudeCodeStatus } from "../../lib/storage.js";

// The dispatcher resolves the provider, applies the key rule, and delegates.
// We drive claude-code through the mocked native-messaging transport and assert
// the keyed/keyless/unknown branches. HTTP providers are only exercised on the
// no-key error path (so no real fetch happens).

afterEach(() => {
  chrome.runtime.lastError = null;
});

describe("callLLM — keyless provider (claude-code)", () => {
  it("dispatches without any API key configured", async () => {
    let sent;
    chrome.runtime.sendNativeMessage = (host, message, cb) => {
      sent = { host, message };
      cb({ text: "from bridge" });
    };
    const out = await callLLM({ provider: "claude-code", system: "s", user: "u" });
    expect(out.text).toBe("from bridge");
    expect(out.provider).toBe("claude-code");
    expect(sent.host).toBe("com.optinmonster.claude_bridge");
  });

  it("passes mode through to the bridge", async () => {
    let sent;
    chrome.runtime.sendNativeMessage = (host, message, cb) => {
      sent = message;
      cb({ text: "ok" });
    };
    await callLLM({ provider: "claude-code", system: "s", user: "u", mode: "reason" });
    expect(sent.mode).toBe("reason");
  });
});

describe("callLLM — keyed providers still require a key", () => {
  beforeEach(async () => {
    await setApiKeys({ gemini: "", claude: "", openai: "" });
  });

  it("errors for a keyed provider with no key (unchanged behaviour)", async () => {
    const out = await callLLM({ provider: "claude", system: "s", user: "u" });
    expect(out).toEqual({ text: "", error: "No API key for claude." });
  });

  it("does NOT pass mode's presence past the key gate for HTTP providers", async () => {
    // Even with mode set, a keyed provider without a key still short-circuits.
    const out = await callLLM({ provider: "openai", system: "s", user: "u", mode: "reason" });
    expect(out.error).toMatch(/No API key for openai/);
  });
});

describe("callLLM — resolution + unknown provider", () => {
  it("returns 'No provider configured' when nothing is chosen or available", async () => {
    await chrome.storage.sync.clear();
    await setApiKeys({ gemini: "", claude: "", openai: "" });
    const out = await callLLM({ system: "s", user: "u" });
    expect(out.error).toMatch(/No provider configured/);
  });

  it("auto-resolves to claude-code (no explicit provider, no keys) when the connector is enabled", async () => {
    await chrome.storage.sync.clear();
    await setApiKeys({ gemini: "", claude: "", openai: "" });
    await setClaudeCodeStatus({ enabled: true, lastPingOk: true, lastPingAt: 1 });
    chrome.runtime.sendNativeMessage = (host, message, cb) => cb({ text: "resolved" });
    const out = await callLLM({ system: "s", user: "u" });
    expect(out).toMatchObject({ text: "resolved", provider: "claude-code" });
  });

  it("keeps the unknown-provider path unchanged (no key => key error first)", async () => {
    await setApiKeys({ gemini: "", claude: "", openai: "" });
    const out = await callLLM({ provider: "mystery", system: "s", user: "u" });
    // Pre-existing ordering: the key check fires before the dispatcher lookup.
    expect(out.error).toMatch(/No API key for mystery/);
  });
});
