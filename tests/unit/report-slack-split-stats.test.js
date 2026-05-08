import { describe, it, expect } from "vitest";
import { buildSlackSnippet } from "../../lib/report-slack.js";

const rangeAudit = {
  rangeStart: "2026-04-06T00:00:00.000Z",
  rangeEnd: "2026-04-12T23:59:59.999Z",
  library: { total: 24, addedInRange: 3, rewritesAbsorbedAllTime: 7 },
  suggestions: { pending: 2, appliedInRange: 4, rejectedInRange: 1, deferredInRange: 0, totalResolvedInRange: 5 },
  suggestionCtr: { total: 12, clicked: 7, ratePercent: 58 },
  customerContext: { total: 30, withContext: 24, ratePercent: 80 },
  readyToSend: 75,
  counts: { generated: 6, sent: 4, rewritten: 1, reachedOutcome: 5 }
};

describe("buildSlackSnippet — range-based audit", () => {
  it("includes split activity line and range-aware suggestion line", () => {
    const out = buildSlackSnippet({ audit: rangeAudit });
    expect(out).toContain("6 generated");
    expect(out).toContain("4 sent/approved");
    expect(out).toContain("1 manager rewrites");
    expect(out).toContain("5/6 reached an outcome in range");
    expect(out).toContain("(+3 in range)");
    expect(out).toContain("4 applied · 1 rejected · 0 deferred");
    expect(out).toContain("of drafts that reached an outcome in range");
  });

  it("legacy shape preserves week phrasing", () => {
    const legacy = {
      library: { total: 10, addedThisWeek: 2, rewritesAbsorbedAllTime: 1 },
      suggestions: { pending: 0, appliedThisWeek: 1, rejectedThisWeek: 0, deferredThisWeek: 0, totalResolvedThisWeek: 1 },
      suggestionCtr: { total: 0, clicked: 0, ratePercent: null },
      customerContext: { total: 0, withContext: 0, ratePercent: null },
      readyToSend: 100
    };
    const out = buildSlackSnippet({ audit: legacy });
    expect(out).not.toContain("generated");
    expect(out).toContain("(+2 this week)");
    expect(out).toContain("personal review pattern");
  });
});
