import { describe, it, expect, beforeEach } from "vitest";
import {
  getAvailableProviders,
  resolveDefaultProvider,
  setApiKeys,
  setClaudeCodeStatus,
  setAllowThirdParty,
  setDefaultProvider,
  getClaudeCodeStatus,
  getAllowThirdParty,
} from "../../lib/storage.js";

const enableConnector = () => setClaudeCodeStatus({ enabled: true, lastPingOk: true, lastPingAt: 1 });

beforeEach(async () => {
  await chrome.storage.sync.clear();
  await setApiKeys({ gemini: "", claude: "", openai: "" });
});

describe("getClaudeCodeStatus / getAllowThirdParty defaults", () => {
  it("connector defaults to disabled, third-party defaults to off", async () => {
    expect(await getClaudeCodeStatus()).toEqual({ enabled: false, lastPingAt: null, lastPingOk: false });
    expect(await getAllowThirdParty()).toBe(false);
  });
  it("setClaudeCodeStatus merges patches", async () => {
    await setClaudeCodeStatus({ enabled: true });
    await setClaudeCodeStatus({ lastPingOk: true, lastPingAt: 42 });
    expect(await getClaudeCodeStatus()).toEqual({ enabled: true, lastPingOk: true, lastPingAt: 42 });
  });
});

describe("getAvailableProviders — availability matrix", () => {
  it("empty when nothing is configured", async () => {
    expect(await getAvailableProviders()).toEqual([]);
  });

  it("claude-code available on enabled + lastPingOk, with NO keys", async () => {
    await enableConnector();
    expect(await getAvailableProviders()).toEqual(["claude-code"]);
  });

  it("claude-code NOT available when enabled but last ping failed", async () => {
    await setClaudeCodeStatus({ enabled: true, lastPingOk: false });
    expect(await getAvailableProviders()).toEqual([]);
  });

  it("claude-code NOT available when ping ok but not enabled", async () => {
    await setClaudeCodeStatus({ enabled: false, lastPingOk: true });
    expect(await getAvailableProviders()).toEqual([]);
  });

  it("direct claude is un-gated (available on key alone)", async () => {
    await setApiKeys({ gemini: "", claude: "sk-ant", openai: "" });
    expect(await getAvailableProviders()).toEqual(["claude"]);
  });

  it("gemini/openai are HIDDEN when keyed but third-party opt-in is off", async () => {
    await setApiKeys({ gemini: "g", claude: "", openai: "o" });
    expect(await getAvailableProviders()).toEqual([]);
  });

  it("gemini/openai appear only when keyed AND third-party opt-in is on", async () => {
    await setApiKeys({ gemini: "g", claude: "", openai: "o" });
    await setAllowThirdParty(true);
    expect(await getAvailableProviders()).toEqual(["gemini", "openai"]);
  });

  it("lists connector first, then claude, then third-party", async () => {
    await enableConnector();
    await setApiKeys({ gemini: "g", claude: "c", openai: "o" });
    await setAllowThirdParty(true);
    expect(await getAvailableProviders()).toEqual(["claude-code", "claude", "gemini", "openai"]);
  });
});

describe("resolveDefaultProvider — ordering + back-compat", () => {
  it("returns null when nothing is available", async () => {
    expect(await resolveDefaultProvider()).toBeNull();
  });

  it("prefers the connector when available and no stored default", async () => {
    await enableConnector();
    await setApiKeys({ gemini: "", claude: "c", openai: "" });
    expect(await resolveDefaultProvider()).toBe("claude-code");
  });

  it("honours a stored default that is still available", async () => {
    await enableConnector();
    await setApiKeys({ gemini: "", claude: "c", openai: "" });
    await setDefaultProvider("claude");
    expect(await resolveDefaultProvider()).toBe("claude");
  });

  it("does NOT clobber the stored default, but falls through when it is now gated", async () => {
    // Existing user had gemini as default; third-party is now off -> gemini gone
    // from availability. Resolution fills the gap without rewriting the stored value.
    await setDefaultProvider("gemini");
    await setApiKeys({ gemini: "g", claude: "", openai: "" });
    await enableConnector();
    expect(await resolveDefaultProvider()).toBe("claude-code");
    // stored value untouched
    const { default_provider } = await chrome.storage.sync.get("default_provider");
    expect(default_provider).toBe("gemini");
  });

  it("falls back to first available when connector is absent and stored default unavailable", async () => {
    await setApiKeys({ gemini: "g", claude: "c", openai: "" });
    await setAllowThirdParty(true);
    await setDefaultProvider("openai"); // not keyed -> unavailable
    // available = [claude, gemini]; no connector -> first available
    expect(await resolveDefaultProvider()).toBe("claude");
  });
});
