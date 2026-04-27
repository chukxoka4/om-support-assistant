// F1 — In-textarea library suggestions ranker.

import { describe, it, expect, vi } from "vitest";
import { rankLexical, rankLLM } from "../../lib/library-rank.js";

const mkEntry = (id, overrides = {}) => {
  const { dropdowns: dOverride, ...rest } = overrides;
  return {
    id,
    product: "OptinMonster",
    scenario_title: "Refund within window",
    scenario_summary: "Customer asks for refund",
    scenario_instruction: "do the thing",
    weighted_score: 0,
    last_used_at: null,
    ...rest,
    dropdowns: {
      goal: "Account Issue",
      audience: "Frustrated Customer",
      tone: "Calm",
      mode: "billing",
      concise: false,
      ...(dOverride || {})
    }
  };
};

const matchingDropdowns = {
  product: "OptinMonster",
  goal: "Account Issue",
  audience: "Frustrated Customer",
  tone: "Calm",
  mode: "billing",
  concise: false
};

describe("rankLexical", () => {
  it("returns at most 5 results, sorted descending by score", () => {
    const entries = Array.from({ length: 8 }, (_, i) =>
      mkEntry(`e${i}`, {
        scenario_title: `Refund within window mention ${i}`,
        weighted_score: i // increasing weight
      })
    );
    const out = rankLexical("customer wants a refund within window", matchingDropdowns, entries);
    expect(out.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < out.length; i++) {
      expect(out[i - 1].score).toBeGreaterThanOrEqual(out[i].score);
    }
  });

  it("hard-filters by product — different products never appear", () => {
    const entries = [
      mkEntry("a", { product: "OptinMonster" }),
      mkEntry("b", { product: "TrustPulse" })
    ];
    const out = rankLexical("refund window", matchingDropdowns, entries);
    expect(out.every((r) => r.entry.product === "OptinMonster")).toBe(true);
  });

  it("dropdown overlap weighted 4 pts each", () => {
    // Build draft with no lexical hits so dropdown is the dominant signal.
    const out = rankLexical("xyz qwerty unrelated", matchingDropdowns, [
      mkEntry("a") // all 4 dropdowns match → +16
    ]);
    // The 16 lifts above the quality floor (8) so we get a result back.
    expect(out).toHaveLength(1);
    expect(out[0].score).toBeGreaterThanOrEqual(16);
    expect(out[0].reason).toMatch(/dropdowns \+16/);
  });

  it("recency bonus +2 within 14 days", () => {
    const recent = mkEntry("recent", { last_used_at: new Date().toISOString() });
    const stale = mkEntry("stale", { last_used_at: "2020-01-01T00:00:00Z" });
    const out = rankLexical("xyz unrelated", matchingDropdowns, [recent, stale]);
    const r = out.find((x) => x.entry.id === "recent");
    const s = out.find((x) => x.entry.id === "stale");
    expect(r.score - s.score).toBe(2);
  });

  it("concise mismatch penalty -2", () => {
    const wantConcise = { ...matchingDropdowns, concise: true };
    const entryConcise = mkEntry("a", { dropdowns: { concise: true } });
    const entryVerbose = mkEntry("b", { dropdowns: { concise: false } });
    const out = rankLexical("xyz unrelated", wantConcise, [entryConcise, entryVerbose]);
    expect(out.length).toBe(2); // both clear the floor
    const a = out.find((x) => x.entry.id === "a");
    const b = out.find((x) => x.entry.id === "b");
    expect(a.score - b.score).toBe(2); // -0 vs -2
  });

  it("quality floor: returns empty when top score < 8", () => {
    // No dropdowns set → no overlap. Draft has no useful tokens → no lex.
    const out = rankLexical("the the the", { product: "OptinMonster" }, [
      mkEntry("a", { dropdowns: { goal: "X", audience: "Y", tone: "Z", mode: "W" } })
    ]);
    expect(out).toEqual([]);
  });

  it("empty entries / no candidates → empty", () => {
    expect(rankLexical("anything", matchingDropdowns, [])).toEqual([]);
    expect(rankLexical("anything", { product: "OptinMonster" }, [
      mkEntry("a", { product: "TrustPulse" })
    ])).toEqual([]);
  });

  it("each result has entry, score, reason", () => {
    const out = rankLexical("refund window", matchingDropdowns, [mkEntry("a")]);
    expect(out[0]).toHaveProperty("entry");
    expect(out[0]).toHaveProperty("score");
    expect(out[0]).toHaveProperty("reason");
    expect(typeof out[0].reason).toBe("string");
  });
});

describe("rankLLM", () => {
  const baseEntries = [mkEntry("a"), mkEntry("b"), mkEntry("c")];

  it("parses JSON, maps ids back to entries, returns top 5", async () => {
    const callLLM = vi.fn(async () => ({
      text: JSON.stringify([
        { id: "b", score: 90, reason: "best fit" },
        { id: "a", score: 60, reason: "ok fit" }
      ])
    }));
    const out = await rankLLM("draft", matchingDropdowns, baseEntries, callLLM);
    expect(out).toHaveLength(2);
    expect(out[0].entry.id).toBe("b");
    expect(out[0].score).toBe(90);
    expect(out[0].reason).toBe("best fit");
    expect(callLLM).toHaveBeenCalledTimes(1);
    const callArg = callLLM.mock.calls[0][0];
    expect(callArg.system).toMatch(/ranking library entries/i);
    expect(callArg.user).toMatch(/Candidates:/);
  });

  it("ignores ids the LLM hallucinated that aren't in the candidate set", async () => {
    const callLLM = async () => ({
      text: JSON.stringify([
        { id: "ghost", score: 99, reason: "fake" },
        { id: "a", score: 50, reason: "real" }
      ])
    });
    const out = await rankLLM("draft", matchingDropdowns, baseEntries, callLLM);
    expect(out.map((r) => r.entry.id)).toEqual(["a"]);
  });

  it("throws labelled error on unparseable JSON", async () => {
    const callLLM = async () => ({ text: "this is not json" });
    await expect(rankLLM("draft", matchingDropdowns, baseEntries, callLLM))
      .rejects.toThrow(/unparseable/i);
  });

  it("throws labelled error when callLLM returns an error field", async () => {
    const callLLM = async () => ({ error: "rate limited" });
    await expect(rankLLM("draft", matchingDropdowns, baseEntries, callLLM))
      .rejects.toThrow(/LLM ranker failed: rate limited/);
  });

  it("hard-filters by product before sending to the LLM", async () => {
    const mixed = [
      mkEntry("om-1", { product: "OptinMonster" }),
      mkEntry("tp-1", { product: "TrustPulse" })
    ];
    const callLLM = vi.fn(async () => ({ text: "[]" }));
    await rankLLM("draft", { product: "OptinMonster" }, mixed, callLLM);
    const sent = callLLM.mock.calls[0][0].user;
    expect(sent).toContain("om-1");
    expect(sent).not.toContain("tp-1");
  });
});
