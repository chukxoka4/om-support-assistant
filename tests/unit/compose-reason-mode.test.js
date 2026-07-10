// DEC-F: compose asks the dispatcher for "reason" mode and injects the
// conditional KB-reasoning instruction into the system prompt. HTTP providers
// ignore mode; the connector uses it to search the local KB while drafting.

import { describe, it, expect, beforeEach, vi } from "vitest";

let captured = null;

vi.mock("../../providers/index.js", () => ({
  callLLM: vi.fn(async (args) => {
    captured = args;
    return {
      text: "REASON: r\nVERSION A: a\nVERSION B: b\nCLEAN_PROMPT: c\nSCENARIO_SUMMARY: s",
      provider: "claude-code",
    };
  }),
}));

const { compose } = await import("../../lib/compose.js");

const baseArgs = {
  product: "OptinMonster",
  draft: "how do I test a geo rule",
  promptExtra: "",
  goal: "Explain Technical Issue",
  mode: "technical",
  audience: "Brand New User",
  tone: "Calm",
  concise: false,
  libraryEntryId: null,
};

describe("compose — reason mode + KB instruction", () => {
  beforeEach(async () => {
    await chrome.storage.local.clear();
    captured = null;
    globalThis.fetch = vi.fn(async () => ({ ok: true, text: async () => "House rules." }));
  });

  it("passes mode: 'reason' to the dispatcher", async () => {
    await compose(baseArgs);
    expect(captured.mode).toBe("reason");
  });

  it("injects the conditional KB-reasoning instruction into the system prompt", async () => {
    await compose(baseArgs);
    expect(captured.system).toMatch(/patterns\/INDEX\.md/);
    expect(captured.system).toMatch(/use ONLY if available/i);
    expect(captured.system).toMatch(/ignore this section/i);
  });

  it("still produces the two rewrites (parsing unaffected by mode)", async () => {
    const out = await compose(baseArgs);
    expect(out.parsed.versionA).toBe("a");
    expect(out.parsed.versionB).toBe("b");
    expect(out.provider).toBe("claude-code");
  });
});
