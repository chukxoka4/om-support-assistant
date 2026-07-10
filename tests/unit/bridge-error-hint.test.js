import { describe, it, expect } from "vitest";
import { bridgeErrorHint } from "../../lib/bridge-error-hint.js";

describe("bridgeErrorHint", () => {
  it("appends a fix hint to Claude Code bridge errors", () => {
    const out = bridgeErrorHint("claude-code bridge unavailable: Native host has exited.");
    expect(out).toMatch(/Native host has exited/);
    expect(out).toMatch(/Test connection/);
    expect(out).toMatch(/bridge\/README\.md/);
  });

  it("recognises the native-messaging-host-not-found phrasing", () => {
    expect(bridgeErrorHint("Specified native messaging host not found.")).toMatch(/Fix:/);
  });

  it("recognises a not-logged-in failure", () => {
    expect(bridgeErrorHint("claude: error — Not logged in · Please run /login")).toMatch(/Fix:/);
  });

  it("passes non-bridge errors through unchanged", () => {
    expect(bridgeErrorHint("No API key for openai.")).toBe("No API key for openai.");
    expect(bridgeErrorHint("Claude 429: rate limited")).toBe("Claude 429: rate limited");
  });

  it("is safe on empty/nullish input", () => {
    expect(bridgeErrorHint("")).toBe("");
    expect(bridgeErrorHint(null)).toBe("");
    expect(bridgeErrorHint(undefined)).toBe("");
  });

  it("does not double-append when called twice", () => {
    const once = bridgeErrorHint("claude-code bridge unavailable: boom");
    const twice = bridgeErrorHint(once);
    expect(twice).toBe(once);
  });
});
