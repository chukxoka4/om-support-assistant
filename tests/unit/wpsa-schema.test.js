// WPSA JSON validator + normaliser.

import { describe, it, expect } from "vitest";
import { parseWpsaJson, validateWpsaShape } from "../../lib/wpsa-schema.js";

const goodPayload = {
  meta: {
    weekStart: "2026-04-19", weekEnd: "2026-04-25",
    agent: "Nwachukwu Okafor", product: "OptinMonster", scope: "personal"
  },
  totals: {
    conversations: 93, replies: 157,
    happiness: { good: 3, okay: 1, bad: 0 }
  },
  categories: [
    { name: "Cancellation Request", conversations: 38, percent: 41 },
    { name: "Pre-Sales", conversations: 5, percent: 5 }
  ],
  frictionLeaderboard: [
    {
      rank: 1, name: "Refund & Auto-Renewal Policies",
      conversations: 38, messages: 45,
      sentiment: "frustrated", rootCause: "documentation_gap",
      representativeQuote: "EU law…",
      evidenceTicketIds: ["40872", "40649"]
    }
  ],
  timeWaster: {
    topic: "Free Plan Limits", occurrences: 4,
    category: "process_repetition", savedReplyDraft: "Hi…"
  },
  oiVerdict: {
    frictionPoint: "Kit Integration Lead Sync",
    outcomeHoursSavedPerWeek: 1.5, inputEffort: "low",
    verdict: "yes", condition: null, rationale: "Clarify…"
  },
  knowledgeGaps: [
    { topic: "Beacon to Kit Sync", ticketCount: 2, recommendation: "Create…" }
  ],
  caveats: ["Happiness sample size n=4."]
};

describe("parseWpsaJson — happy path", () => {
  it("accepts the WPSA AI's actual output verbatim", () => {
    const r = parseWpsaJson(JSON.stringify(goodPayload));
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.normalised.frictionLeaderboard[0].name).toMatch(/Refund/);
    expect(r.normalised.totals.happiness.good).toBe(3);
  });

  it("strips markdown code fences if the AI added them", () => {
    const wrapped = "```json\n" + JSON.stringify(goodPayload) + "\n```";
    const r = parseWpsaJson(wrapped);
    expect(r.ok).toBe(true);
  });

  it("strips prose around the JSON object", () => {
    const r = parseWpsaJson(`Sure, here is the result: ${JSON.stringify(goodPayload)} Hope this helps!`);
    expect(r.ok).toBe(true);
  });
});

describe("parseWpsaJson — bad inputs", () => {
  it("empty input → labelled error", () => {
    expect(parseWpsaJson("").ok).toBe(false);
    expect(parseWpsaJson("   ").errors[0]).toMatch(/empty/);
  });

  it("non-JSON → labelled error", () => {
    expect(parseWpsaJson("not json").ok).toBe(false);
    expect(parseWpsaJson("not json").errors[0]).toMatch(/not valid JSON/);
  });

  it("array root → fails", () => {
    expect(parseWpsaJson("[]").ok).toBe(false);
  });
});

describe("validateWpsaShape — required fields", () => {
  it("missing meta.weekStart fails", () => {
    const bad = JSON.parse(JSON.stringify(goodPayload));
    delete bad.meta.weekStart;
    const r = validateWpsaShape(bad);
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("meta.weekStart missing");
  });

  it("non-numeric totals fails", () => {
    const bad = JSON.parse(JSON.stringify(goodPayload));
    bad.totals.conversations = "lots";
    const r = validateWpsaShape(bad);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/totals.conversations/);
  });

  it("empty frictionLeaderboard fails", () => {
    const bad = JSON.parse(JSON.stringify(goodPayload));
    bad.frictionLeaderboard = [];
    expect(validateWpsaShape(bad).ok).toBe(false);
  });

  it("frictionLeaderboard > 3 fails", () => {
    const bad = JSON.parse(JSON.stringify(goodPayload));
    bad.frictionLeaderboard = [
      bad.frictionLeaderboard[0],
      { ...bad.frictionLeaderboard[0], rank: 2 },
      { ...bad.frictionLeaderboard[0], rank: 3 },
      { ...bad.frictionLeaderboard[0], rank: 4 }
    ];
    expect(validateWpsaShape(bad).ok).toBe(false);
  });
});

describe("validateWpsaShape — enum coverage", () => {
  it("rejects unknown sentiment", () => {
    const bad = JSON.parse(JSON.stringify(goodPayload));
    bad.frictionLeaderboard[0].sentiment = "vibing";
    const r = validateWpsaShape(bad);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/sentiment/);
  });

  it("rejects unknown verdict", () => {
    const bad = JSON.parse(JSON.stringify(goodPayload));
    bad.oiVerdict.verdict = "maybe";
    const r = validateWpsaShape(bad);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/verdict/);
  });

  it("rejects unknown scope", () => {
    const bad = JSON.parse(JSON.stringify(goodPayload));
    bad.meta.scope = "department";
    const r = validateWpsaShape(bad);
    expect(r.ok).toBe(false);
  });
});

describe("validateWpsaShape — normalisation", () => {
  it("fills optional missing arrays with []", () => {
    const minimal = {
      meta: { weekStart: "2026-04-19", weekEnd: "2026-04-25" },
      totals: { conversations: 1, replies: 1 },
      categories: [{ name: "x", conversations: 1, percent: 100 }],
      frictionLeaderboard: [{ rank: 1, name: "y", conversations: 1 }]
    };
    const r = validateWpsaShape(minimal);
    expect(r.ok).toBe(true);
    expect(r.normalised.knowledgeGaps).toEqual([]);
    expect(r.normalised.caveats).toEqual([]);
    expect(r.normalised.timeWaster).toBeNull();
    expect(r.normalised.oiVerdict).toBeNull();
  });
});
