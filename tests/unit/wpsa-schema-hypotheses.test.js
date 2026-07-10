// Schema accepts optional hypothesisFindings[]. Unknown supported values
// are dropped to null rather than failing validation, so a flaky analyser
// can't break the whole report.

import { describe, it, expect } from "vitest";
import { validateWpsaShape } from "../../lib/wpsa-schema.js";

const valid = {
  meta: { weekStart: "2026-04-06", weekEnd: "2026-04-12", scope: "personal", agent: "Joseph", product: "OptinMonster" },
  totals: { conversations: 10, replies: 20, happiness: { good: 1, okay: 0, bad: 0 } },
  categories: [{ name: "Billing", conversations: 10, percent: 100 }],
  frictionLeaderboard: [{ rank: 1, name: "Refunds", conversations: 5, sentiment: "frustrated", rootCause: "documentation_gap", evidenceTicketIds: ["1"] }],
  caveats: []
};

describe("wpsa-schema — hypothesisFindings", () => {
  it("normalises to an empty array when missing", () => {
    const r = validateWpsaShape(valid);
    expect(r.ok).toBe(true);
    expect(r.normalised.hypothesisFindings).toEqual([]);
  });

  it("accepts well-formed findings", () => {
    const payload = {
      ...valid,
      hypothesisFindings: [
        {
          hypothesis: "Users duplicate campaigns",
          supported: "partially",
          evidence: "3 of 10 tickets mention duplicate-then-edit",
          supportingTicketIds: ["123", 456],
          frictionReframe: "Refunds bucket may be hiding duplicate-button confusion",
          oiImpact: "If true, escalate from 'watch' to 'escalate'",
          recommendedAction: "Add a saved-reply explaining the duplicate flow"
        }
      ]
    };
    const r = validateWpsaShape(payload);
    expect(r.ok).toBe(true);
    expect(r.normalised.hypothesisFindings).toHaveLength(1);
    const h = r.normalised.hypothesisFindings[0];
    expect(h.hypothesis).toBe("Users duplicate campaigns");
    expect(h.supported).toBe("partially");
    expect(h.supportingTicketIds).toEqual(["123", "456"]); // numbers coerced
    expect(h.frictionReframe).toContain("Refunds bucket");
    expect(h.recommendedAction).toContain("saved-reply");
  });

  it("drops unknown supported values to null without failing the report", () => {
    const r = validateWpsaShape({
      ...valid,
      hypothesisFindings: [{ hypothesis: "x", supported: "maybe" }]
    });
    expect(r.ok).toBe(true);
    expect(r.normalised.hypothesisFindings[0].supported).toBeNull();
  });

  it("filters out findings without a hypothesis text", () => {
    const r = validateWpsaShape({
      ...valid,
      hypothesisFindings: [
        { supported: "yes" }, // no hypothesis
        { hypothesis: "" },   // blank hypothesis
        { hypothesis: "real one", supported: "no" }
      ]
    });
    expect(r.ok).toBe(true);
    expect(r.normalised.hypothesisFindings).toHaveLength(1);
    expect(r.normalised.hypothesisFindings[0].hypothesis).toBe("real one");
  });

  it("normalises missing optional fields to null/empty", () => {
    const r = validateWpsaShape({
      ...valid,
      hypothesisFindings: [{ hypothesis: "h", supported: "yes" }]
    });
    const h = r.normalised.hypothesisFindings[0];
    expect(h.evidence).toBe("");
    expect(h.supportingTicketIds).toEqual([]);
    expect(h.frictionReframe).toBeNull();
    expect(h.oiImpact).toBeNull();
    expect(h.recommendedAction).toBeNull();
  });
});
