// Slack snippet generator — markdown-friendly text output.

import { describe, it, expect } from "vitest";
import { buildSlackSnippet } from "../../lib/report-slack.js";

const personal = {
  meta: { weekStart: "2026-04-19", weekEnd: "2026-04-25", agent: "Nwachukwu Okafor" },
  totals: { conversations: 93, replies: 157, happiness: { good: 3, okay: 1, bad: 0 } },
  categories: [
    { name: "Cancellation Request", conversations: 38 },
    { name: "Pre-Sales", conversations: 5 }
  ],
  frictionLeaderboard: []
};

const team = {
  meta: { weekStart: "2026-04-19", weekEnd: "2026-04-25", agent: "Team" },
  totals: { conversations: 184, replies: 414, happiness: null },
  categories: [],
  frictionLeaderboard: [
    { rank: 1, name: "Refunds", conversations: 38, messages: 45, sentiment: "frustrated" },
    { rank: 2, name: "Mobile sep", conversations: 25 }
  ],
  oiVerdict: { frictionPoint: "Refunds", outcomeHoursSavedPerWeek: 4.5, inputEffort: "low", verdict: "yes", rationale: "Doc fix." },
  timeWaster: { topic: "Free plan pitch", occurrences: 4 },
  knowledgeGaps: [{ topic: "Kit sync" }],
  caveats: ["Sample size n=4."]
};

const audit = {
  windowDays: 7,
  library: { total: 24, addedThisWeek: 3, rewritesAbsorbedAllTime: 7 },
  suggestions: { pending: 2, appliedThisWeek: 4, rejectedThisWeek: 1, deferredThisWeek: 0, totalResolvedThisWeek: 5 },
  suggestionCtr: { total: 12, clicked: 7, ratePercent: 58 },
  customerContext: { total: 30, withContext: 24, ratePercent: 80 },
  readyToSend: 91
};

describe("buildSlackSnippet", () => {
  it("includes the week range and agent in the title", () => {
    const out = buildSlackSnippet({ personalWpsa: personal, teamWpsa: team, audit });
    expect(out).toContain("2026-04-19");
    expect(out).toContain("2026-04-25");
    expect(out).toContain("Nwachukwu Okafor");
  });

  it("renders all three sections when all inputs present", () => {
    const out = buildSlackSnippet({ personalWpsa: personal, teamWpsa: team, audit });
    expect(out).toContain("1. My week");
    expect(out).toContain("2. AI loop progress");
    expect(out).toContain("3. What customers are saying");
  });

  it("section 2 carries the key audit numbers", () => {
    const out = buildSlackSnippet({ audit });
    expect(out).toContain("24 entries");
    expect(out).toContain("Ready-to-Send rate: 91%");
    expect(out).toContain("personal review pattern");
    expect(out).toContain("CTR: 58%");
  });

  it("section 3 leads with the #1 friction point", () => {
    const out = buildSlackSnippet({ teamWpsa: team });
    expect(out).toContain("#1 friction: *Refunds*");
    expect(out).toContain("YES");
    expect(out).toContain("Doc fix.");
  });

  it("ask shows up at the end when present", () => {
    const out = buildSlackSnippet({ teamWpsa: team, ask: "Ship the GA push" });
    expect(out).toContain("*Ask:* Ship the GA push");
  });

  it("no ask → no Ask section", () => {
    const out = buildSlackSnippet({ teamWpsa: team });
    expect(out).not.toContain("*Ask:*");
  });

  it("works with only one section's input (graceful)", () => {
    const out = buildSlackSnippet({ audit });
    expect(out).toContain("AI loop progress");
    expect(out).not.toContain("My week");
    expect(out).not.toContain("What customers are saying");
  });
});
