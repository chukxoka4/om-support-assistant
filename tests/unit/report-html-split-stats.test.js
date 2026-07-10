// Range-based audit shape: report should render the three split top-line
// counts (Generated / Sent / Rewritten) and the daily activity multi-line
// chart. Legacy shape coverage stays in report-html.test.js.

import { describe, it, expect } from "vitest";
import { buildReportHtml } from "../../lib/report-html.js";

const rangeAudit = {
  rangeStart: "2026-04-06T00:00:00.000Z",
  rangeEnd: "2026-04-12T23:59:59.999Z",
  generatedAt: new Date().toISOString(),
  library: { total: 24, addedInRange: 3, seedCount: 18, generatedCount: 6, rewritesAbsorbedAllTime: 7 },
  librarySeries: [{ x: "04-06", y: 21 }, { x: "04-12", y: 24 }],
  activitySeries: [
    { x: "04-06", generated: 2, sent: 1, rewritten: 0 },
    { x: "04-07", generated: 3, sent: 2, rewritten: 1 },
    { x: "04-08", generated: 1, sent: 1, rewritten: 0 }
  ],
  suggestions: { pending: 2, needsManual: 1, appliedInRange: 4, rejectedInRange: 1, deferredInRange: 0, totalResolvedInRange: 5 },
  suggestionCtr: { total: 12, clicked: 7, ratePercent: 58 },
  customerContext: { total: 30, withContext: 24, ratePercent: 80 },
  readyToSend: 75,
  counts: { generated: 6, sent: 4, rewritten: 1, reachedOutcome: 5 }
};

describe("buildReportHtml — range-based audit", () => {
  it("renders the three split counts as top-line stats", () => {
    const html = buildReportHtml({ audit: rangeAudit });
    expect(html).toContain("Drafts generated");
    expect(html).toContain("Sent / approved");
    expect(html).toContain("Manager rewrites");
    expect(html).toContain("Reached an outcome");
    // Exact values
    expect(html).toMatch(/>6<.*Drafts generated/s);
    expect(html).toMatch(/>4<.*Sent \/ approved/s);
    expect(html).toMatch(/>1<.*Manager rewrites/s);
  });

  it("includes the daily activity multi-line chart", () => {
    const html = buildReportHtml({ audit: rangeAudit });
    expect(html).toContain("Daily activity in range");
    expect(html).toContain("Generated");
    expect(html).toContain("Sent / approved");
    expect(html).toContain("Manager rewrites");
  });

  it("uses range-suffixed labels and footnotes", () => {
    const html = buildReportHtml({ audit: rangeAudit });
    expect(html).toContain("+3 in range");
    expect(html).toContain("Suggestions resolved in range");
    expect(html).toContain("of drafts that reached an outcome in range");
    expect(html).toContain("Library size across range");
  });

  it("legacy audit shape still renders without the activity chart", () => {
    const legacy = {
      windowDays: 7,
      generatedAt: new Date().toISOString(),
      library: { total: 10, addedThisWeek: 2, seedCount: 8, generatedCount: 2, rewritesAbsorbedAllTime: 1 },
      librarySeries: [{ x: "04-06", y: 10 }],
      suggestions: { pending: 0, needsManual: 0, appliedThisWeek: 1, rejectedThisWeek: 0, deferredThisWeek: 0, totalResolvedThisWeek: 1 },
      suggestionCtr: { total: 0, clicked: 0, ratePercent: null },
      customerContext: { total: 0, withContext: 0, ratePercent: null },
      readyToSend: 100,
      composedThisWeek: 5
    };
    const html = buildReportHtml({ audit: legacy });
    expect(html).not.toContain("Daily activity in range");
    expect(html).not.toContain("Drafts generated"); // top-line activity counters are range-only
    expect(html).toContain("personal review pattern"); // legacy footnote
  });
});
