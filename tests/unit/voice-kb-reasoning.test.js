// DEC-F: buildSystemPrompt can append a conditional KB-reasoning instruction.
// It must be present only when requested, and phrased so it's harmless when no
// tools / knowledge base exist (transform fallback, HTTP providers).

import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildSystemPrompt } from "../../lib/voice.js";

beforeEach(() => {
  // getHouseStyle fetches prompts/house-style.md; return a stub.
  globalThis.fetch = vi.fn(async () => ({ ok: true, text: async () => "House rules." }));
});

const base = {
  product: "OptinMonster",
  dropdowns: { goal: "Account Issue", audience: "VIP Client", tone: "Calm", mode: "billing" },
  concise: false,
};

describe("buildSystemPrompt — KB reasoning block", () => {
  it("omits the KB section by default", async () => {
    const sys = await buildSystemPrompt(base);
    expect(sys).not.toMatch(/knowledge base/i);
    expect(sys).not.toMatch(/patterns\/INDEX\.md/);
  });

  it("includes the KB section when requested", async () => {
    const sys = await buildSystemPrompt({ ...base, includeKbReasoning: true });
    expect(sys).toMatch(/patterns\/INDEX\.md/);
    expect(sys).toMatch(/Grep|Read|Glob/);
    expect(sys).toMatch(/cite that pattern's documentation URL/i);
  });

  it("phrases the KB section conditionally so it's harmless without tools", async () => {
    const sys = await buildSystemPrompt({ ...base, includeKbReasoning: true });
    expect(sys).toMatch(/use ONLY if available/i);
    expect(sys).toMatch(/ignore this section/i);
    expect(sys).toMatch(/do not mention a knowledge base/i);
  });

  it("still includes the library task alongside KB reasoning", async () => {
    const sys = await buildSystemPrompt({ ...base, includeKbReasoning: true, includeLibraryTask: true });
    expect(sys).toMatch(/CLEAN_PROMPT/);
    expect(sys).toMatch(/patterns\/INDEX\.md/);
  });
});
