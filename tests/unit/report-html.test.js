// HTML report generator — assertable substrings.

import { describe, it, expect } from "vitest";
import { buildReportHtml } from "../../lib/report-html.js";

const personal = {
  meta: { weekStart: "2026-04-19", weekEnd: "2026-04-25", agent: "Nwachukwu Okafor", scope: "personal" },
  totals: { conversations: 93, replies: 157, happiness: { good: 3, okay: 1, bad: 0 } },
  categories: [
    { name: "Cancellation Request", conversations: 38, percent: 41 },
    { name: "Pre-Sales", conversations: 5, percent: 5 }
  ],
  frictionLeaderboard: [
    { rank: 1, name: "Refunds", conversations: 38, sentiment: "frustrated", rootCause: "documentation_gap", evidenceTicketIds: [] }
  ],
  timeWaster: null,
  oiVerdict: null,
  knowledgeGaps: [],
  caveats: []
};

const team = {
  meta: { weekStart: "2026-04-19", weekEnd: "2026-04-25", agent: "Team", scope: "team" },
  totals: { conversations: 184, replies: 414, happiness: null },
  categories: [{ name: "Billing", conversations: 127, percent: 69 }],
  frictionLeaderboard: [
    { rank: 1, name: "Mobile/desktop separation", conversations: 25, messages: 44,
      sentiment: "frustrated", rootCause: "ui_workflow",
      representativeQuote: "Where did the visitor device rule go?",
      evidenceTicketIds: ["40872", "40649"] },
    { rank: 2, name: "Refunds", conversations: 8, sentiment: "frustrated", rootCause: "documentation_gap", evidenceTicketIds: [] }
  ],
  timeWaster: { topic: "Free plan upgrade pitch", occurrences: 4, category: "process_repetition", savedReplyDraft: "Hi! Reaching out…" },
  oiVerdict: {
    frictionPoint: "Mobile/desktop separation",
    primaryGrowthLever: "churn",
    mveBootstrap: "Add a saved-reply linking the workaround doc.",
    escalationVerdict: "escalate",
    outcomeHoursSavedPerWeek: 4.5, inputEffort: "low",
    verdict: "yes", condition: null, rationale: "Already in early access — promote to GA."
  },
  knowledgeGaps: [{ topic: "Subdomain routing", ticketCount: 2, recommendation: "Doc snippet" }],
  caveats: ["Happiness n=2 too small to weigh."]
};

const audit = {
  windowDays: 7,
  generatedAt: new Date().toISOString(),
  library: { total: 24, addedThisWeek: 3, seedCount: 18, generatedCount: 6, refinedCountAllTime: 4, rewritesAbsorbedAllTime: 7 },
  librarySeries: [{ x: "04-21", y: 21 }, { x: "04-22", y: 22 }, { x: "04-25", y: 24 }],
  suggestions: { pending: 2, needsManual: 1, appliedThisWeek: 4, rejectedThisWeek: 1, deferredThisWeek: 0, totalResolvedThisWeek: 5 },
  suggestionCtr: { total: 12, clicked: 7, ratePercent: 58 },
  customerContext: { total: 30, withContext: 24, ratePercent: 80 },
  readyToSend: 91,
  composedThisWeek: 30
};

describe("buildReportHtml", () => {
  it("returns a full HTML document with all three sections", () => {
    const html = buildReportHtml({ personalWpsa: personal, teamWpsa: team, audit, ask: "Promote unified-device feature to GA" });
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain("Section 1");
    expect(html).toContain("Section 2");
    expect(html).toContain("Section 3");
    expect(html).toContain("Section 4");
    expect(html).toContain("Weekly Support Insights");
    expect(html).toContain("Nwachukwu Okafor");
  });

  it("section 1 carries personal WPSA totals + categories", () => {
    const html = buildReportHtml({ personalWpsa: personal });
    expect(html).toContain("93");
    expect(html).toContain("157");
    expect(html).toContain("Cancellation Request");
  });

  it("section 2 carries audit metrics + Ready-to-Send footnote", () => {
    const html = buildReportHtml({ audit });
    expect(html).toContain("Library size");
    expect(html).toContain("91%");
    expect(html).toContain("personal review pattern");
    expect(html).toContain("80%"); // customer-context coverage
  });

  it("section 3 surfaces friction leaderboard with rank styling and quotes", () => {
    const html = buildReportHtml({ teamWpsa: team });
    expect(html).toContain("rank-1");
    expect(html).toContain("Mobile/desktop separation");
    expect(html).toContain("Where did the visitor device rule go?");
    expect(html).toContain("40872"); // evidence ticket
    expect(html).toContain("oi-verdict yes");
  });

  it("O/I card surfaces the new growth lever pill, escalation verdict, and bootstrap line", () => {
    const html = buildReportHtml({ teamWpsa: team });
    expect(html).toContain("escalation-verdict escalation-escalate");
    expect(html).toContain("ESCALATE");
    expect(html).toContain("lever-pill lever-churn");
    expect(html).toContain("Churn");
    expect(html).toContain("Bootstrap option");
    expect(html).toContain("Add a saved-reply linking the workaround doc.");
  });

  it("O/I card omits new fields gracefully when they're null", () => {
    const minimal = JSON.parse(JSON.stringify(team));
    minimal.oiVerdict.primaryGrowthLever = null;
    minimal.oiVerdict.mveBootstrap = null;
    minimal.oiVerdict.escalationVerdict = null;
    const html = buildReportHtml({ teamWpsa: minimal });
    // Pill class definitions live in the embedded CSS but no pill markup
    // should be rendered when primaryGrowthLever is null.
    expect(html).not.toMatch(/class="lever-pill/);
    expect(html).not.toContain("Bootstrap option");
    // Falls back to "WATCH" headline class when escalationVerdict missing.
    expect(html).toContain("escalation-watch");
  });

  it("header shows author + analysed agent when they differ", () => {
    const html = buildReportHtml({
      personalWpsa: { ...personal, meta: { ...personal.meta, agent: "Erica Franz" } },
      reportAuthor: "Nwachukwu Okafor"
    });
    expect(html).toContain("About Erica Franz · prepared by Nwachukwu Okafor");
  });

  it("header collapses to 'By <author>' when author = analysed agent", () => {
    const html = buildReportHtml({
      personalWpsa: personal,
      reportAuthor: "Nwachukwu Okafor"
    });
    expect(html).toContain("By Nwachukwu Okafor");
    expect(html).not.toMatch(/About .* · prepared by/);
  });

  it("header omits attribution gracefully when both blank", () => {
    const html = buildReportHtml({ teamWpsa: { ...team, meta: { ...team.meta, agent: null } } });
    expect(html).toContain("Weekly Support Insights");
    expect(html).not.toMatch(/By\s/);
    expect(html).not.toMatch(/About\s/);
  });

  it("section 4 ask is omitted when blank", () => {
    const html = buildReportHtml({ teamWpsa: team });
    expect(html).not.toContain("Section 4");
  });

  it("missing personal scope shows a polite no-data block, doesn't crash", () => {
    const html = buildReportHtml({ teamWpsa: team });
    expect(html).toContain("No personal WPSA JSON provided");
  });

  it("CSS is inlined; no external <link> or <script>", () => {
    const html = buildReportHtml({ teamWpsa: team, audit });
    expect(html).not.toMatch(/<link\s/);
    expect(html).not.toMatch(/<script\s/);
    expect(html).toMatch(/<style>/);
  });

  it("escapes HTML in user-provided text (representativeQuote, ask)", () => {
    const evil = JSON.parse(JSON.stringify(team));
    evil.frictionLeaderboard[0].representativeQuote = "<script>alert(1)</script>";
    const html = buildReportHtml({ teamWpsa: evil, ask: "<img onerror>" });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img onerror>");
    expect(html).toContain("&lt;script&gt;");
  });
});
