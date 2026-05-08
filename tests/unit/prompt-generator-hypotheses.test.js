// buildWpsaPrompt — optional hypotheses param. Additive: prompts without
// hypotheses are byte-identical to today; prompts with hypotheses get a new
// "User hypotheses to investigate" block + an extra schema field.

import { describe, it, expect } from "vitest";
import { buildWpsaPrompt } from "../../lib/prompt-generator.js";

const base = { scope: "personal", weekStart: "2026-04-06", weekEnd: "2026-04-12", agent: "Joseph" };

describe("buildWpsaPrompt — hypotheses", () => {
  it("omits the hypothesis block when none are passed (no churn)", () => {
    const out = buildWpsaPrompt(base);
    expect(out).not.toContain("User hypotheses to investigate");
    expect(out).not.toContain("hypothesisFindings");
  });

  it("ignores empty / whitespace-only hypotheses", () => {
    const out = buildWpsaPrompt({ ...base, hypotheses: ["   ", "", null, undefined] });
    expect(out).not.toContain("User hypotheses to investigate");
    expect(out).not.toContain("hypothesisFindings");
  });

  it("appends each non-empty hypothesis as a numbered bullet", () => {
    const out = buildWpsaPrompt({
      ...base,
      hypotheses: [
        "Users are duplicating campaigns instead of creating new ones",
        "  ", // skipped
        "New billing UI is causing refund tickets"
      ]
    });
    expect(out).toContain("User hypotheses to investigate");
    expect(out).toContain("1. Users are duplicating campaigns");
    expect(out).toContain("2. New billing UI is causing refund tickets");
  });

  it("instructs the analyser to produce per-finding mini-reports", () => {
    const out = buildWpsaPrompt({ ...base, hypotheses: ["test"] });
    expect(out).toContain("supported");
    expect(out).toContain("frictionReframe");
    expect(out).toContain("oiImpact");
    expect(out).toContain("recommendedAction");
    expect(out).toContain("supportingTicketIds");
  });

  it("warns the analyser not to let hypotheses override the headline numbers", () => {
    const out = buildWpsaPrompt({ ...base, hypotheses: ["test"] });
    expect(out.toLowerCase()).toMatch(/additive|do not let|must reflect what the tickets/i);
  });

  it("adds hypothesisFindings to the schema when hypotheses are present", () => {
    const out = buildWpsaPrompt({ ...base, hypotheses: ["test"] });
    expect(out).toContain('"hypothesisFindings"');
    expect(out).toContain('"supported": "yes|partially|no|insufficient_data"');
  });
});
