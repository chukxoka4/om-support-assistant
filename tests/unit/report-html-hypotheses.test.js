// HTML report — hypothesis section renders only when findings are present.
// When absent, no header/shell appears at all (hard rule from the user).

import { describe, it, expect } from "vitest";
import { buildReportHtml } from "../../lib/report-html.js";

const personalNoHyp = {
  meta: { weekStart: "2026-04-06", weekEnd: "2026-04-12", agent: "Joseph", scope: "personal" },
  totals: { conversations: 5, replies: 8, happiness: null },
  categories: [{ name: "Billing", conversations: 5, percent: 100 }],
  frictionLeaderboard: [{ rank: 1, name: "Refunds", conversations: 3, sentiment: "frustrated", rootCause: "documentation_gap", evidenceTicketIds: [] }],
  timeWaster: null, oiVerdict: null, knowledgeGaps: [], caveats: [],
  hypothesisFindings: []
};

const findings = [
  {
    hypothesis: "Users duplicate campaigns instead of creating new",
    supported: "partially",
    evidence: "3 of 10 tickets mention duplicate-then-edit",
    supportingTicketIds: ["123", "456"],
    frictionReframe: "Refunds bucket may be hiding duplicate-button confusion",
    oiImpact: "Escalation should move from watch to escalate if pattern persists",
    recommendedAction: "Ship a saved-reply for the duplicate flow"
  },
  {
    hypothesis: "Billing UI is confusing new users",
    supported: "insufficient_data",
    evidence: "Only 2 tickets in the range — too small to call.",
    supportingTicketIds: [],
    frictionReframe: null,
    oiImpact: null,
    recommendedAction: null
  }
];

describe("buildReportHtml — hypothesis section", () => {
  it("renders nothing when no findings exist", () => {
    const html = buildReportHtml({ personalWpsa: personalNoHyp });
    expect(html).not.toContain("Hypotheses investigated");
    expect(html).not.toContain('class="hyp-card"'); // markup, not CSS rules
    expect(html).not.toContain('section-tag">Hypotheses<');
  });

  it("renders the section + a card per finding when findings exist", () => {
    const html = buildReportHtml({
      personalWpsa: { ...personalNoHyp, hypothesisFindings: findings }
    });
    expect(html).toContain("Hypotheses investigated (2)");
    expect(html).toContain("Users duplicate campaigns instead of creating new");
    expect(html).toContain("Billing UI is confusing new users");
    expect(html).toContain("hyp-badge partially");
    expect(html).toContain("hyp-badge insufficient_data");
    expect(html).toContain("Partially supported");
    expect(html).toContain("Insufficient data");
  });

  it("renders the collapsible mini-report (details) only when impact fields are present", () => {
    const html = buildReportHtml({
      personalWpsa: { ...personalNoHyp, hypothesisFindings: findings }
    });
    // Card 1 has all three impact fields → details opens up, default
    // collapsed (we don't set `open`).
    expect(html).toContain("How this reframes leaderboard / O/I");
    expect(html).toContain("Refunds bucket may be hiding");
    expect(html).toContain("Recommended action");
    // Card 2 has none → no details element. Count occurrences.
    const detailsCount = (html.match(/<details class="hyp-mini">/g) || []).length;
    expect(detailsCount).toBe(1);
  });

  it("preserves the no-script invariant of the report", () => {
    const html = buildReportHtml({
      personalWpsa: { ...personalNoHyp, hypothesisFindings: findings }
    });
    expect(html).not.toMatch(/<script\s/);
  });

  it("dedupes findings shared between personal and team scope", () => {
    const personal = { ...personalNoHyp, hypothesisFindings: [findings[0]] };
    const team = {
      ...personalNoHyp,
      meta: { ...personalNoHyp.meta, scope: "team", agent: "Team" },
      hypothesisFindings: [findings[0], findings[1]] // first one duplicates
    };
    const html = buildReportHtml({ personalWpsa: personal, teamWpsa: team });
    expect(html).toContain("Hypotheses investigated (2)");
    // First hypothesis should appear once (text-wise, not counting CSS).
    const matches = html.match(/Users duplicate campaigns instead of creating new/g) || [];
    expect(matches.length).toBe(1);
  });

  it("escapes HTML in user-supplied hypothesis text", () => {
    const evil = [{
      hypothesis: '<script>alert(1)</script>',
      supported: "no",
      evidence: '<img onerror=foo>',
      supportingTicketIds: [],
      frictionReframe: null, oiImpact: null, recommendedAction: null
    }];
    const html = buildReportHtml({
      personalWpsa: { ...personalNoHyp, hypothesisFindings: evil }
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img onerror=foo>");
    expect(html).toContain("&lt;script&gt;");
  });
});
