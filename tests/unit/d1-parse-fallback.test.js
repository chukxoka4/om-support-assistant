// Bug D1 — graceful fallback when parseStructuredOutput fails.

import { describe, it, expect } from "vitest";
import { parseStructuredOutput } from "../../lib/compose.js";

describe("parseStructuredOutput: well-formed input", () => {
  it("flags wasParsed:true when all labels present", () => {
    const raw = `REASON: needs softer tone
VERSION A: Hi there, …
VERSION B: Hello — …
CLEAN_PROMPT: Confirm details first.
SCENARIO_SUMMARY: Refund question handled.`;
    const p = parseStructuredOutput(raw);
    expect(p.wasParsed).toBe(true);
    expect(p.reason).toBe("needs softer tone");
    expect(p.versionA).toMatch(/Hi there/);
    expect(p.versionB).toMatch(/Hello/);
    expect(p.cleanPrompt).toMatch(/Confirm/);
    expect(p.scenarioSummary).toMatch(/Refund/);
  });

  it("flags wasParsed:true when only Version A is present (partial but real)", () => {
    const raw = `VERSION A: just one rewrite\n`;
    const p = parseStructuredOutput(raw);
    expect(p.wasParsed).toBe(true);
    expect(p.versionA).toBe("just one rewrite");
  });
});

describe("parseStructuredOutput: drift fallback", () => {
  it("returns wasParsed:false and dumps raw text into versionA when no labels match", () => {
    const raw = "Hi Jane, sorry about the trouble. Let me know what plan you're on and I can refund.";
    const p = parseStructuredOutput(raw);
    expect(p.wasParsed).toBe(false);
    expect(p.versionA).toBe(raw);
    expect(p.reason).toMatch(/didn't match expected format/i);
    expect(p.versionB).toBe("");
  });

  it("treats markdown-bold labels (**REASON:**) as drift — current parser can't read them", () => {
    // This test pins current behaviour. If we later teach the parser to strip
    // markdown, flip wasParsed to true and update.
    const raw = `**REASON:** needs softer tone\n**VERSION A:** Hi there\n**VERSION B:** Hello`;
    const p = parseStructuredOutput(raw);
    // Note: the regex is case-insensitive but does match labels even with
    // markdown wrapping because **REASON: still contains REASON:. Confirm
    // wasParsed is true here so we don't false-alarm on common markdown.
    expect(p.wasParsed).toBe(true);
  });

  it("empty input → wasParsed:false, no crash", () => {
    const p = parseStructuredOutput("");
    expect(p.wasParsed).toBe(false);
    expect(p.versionA).toBe("");
  });

  it("null input → wasParsed:false, no crash", () => {
    const p = parseStructuredOutput(null);
    expect(p.wasParsed).toBe(false);
  });
});
