// Library import diff + merge — pure helpers shared by Options and side panel.

import { describe, it, expect } from "vitest";
import { diffImport, mergeNewOnly } from "../../lib/library-import.js";

const make = (id, overrides = {}) => ({
  id,
  product: "OptinMonster",
  dropdowns: {
    goal: "Account Issue",
    audience: "Frustrated Customer",
    tone: "Calm",
    mode: "billing",
    concise: false,
    ...(overrides.dropdowns || {})
  },
  scenario_instruction: overrides.scenario_instruction || "do the thing",
  scenario_title: "t",
  scenario_summary: "s",
  score: { initial_uses: 5, sent_as_is: 1, manager_approved: 0, rewrites_absorbed: 0 },
  pending_suggestions: [],
  ...overrides
});

describe("diffImport", () => {
  it("buckets entries into toAdd / sameAsLocal / conflicts", () => {
    const current = [make("a"), make("b"), make("c")];
    const incoming = [
      make("a"),                                              // identical
      make("b", { scenario_instruction: "different now" }),  // conflict
      make("d")                                               // new
    ];
    const d = diffImport(current, incoming);
    expect(d.toAdd.map((e) => e.id)).toEqual(["d"]);
    expect(d.sameAsLocal.map((e) => e.id)).toEqual(["a"]);
    expect(d.conflicts.map((c) => c.incoming.id)).toEqual(["b"]);
    expect(d.currentTotal).toBe(3);
    expect(d.incomingTotal).toBe(3);
  });

  it("treats different dropdowns as a conflict, not identical", () => {
    const current = [make("a")];
    const incoming = [make("a", { dropdowns: { tone: "Direct" } })];
    const d = diffImport(current, incoming);
    expect(d.conflicts).toHaveLength(1);
    expect(d.sameAsLocal).toHaveLength(0);
  });

  it("handles empty current library", () => {
    const d = diffImport([], [make("a"), make("b")]);
    expect(d.toAdd).toHaveLength(2);
    expect(d.currentTotal).toBe(0);
  });
});

describe("mergeNewOnly", () => {
  it("appends only entries with new ids", () => {
    const current = [make("a"), make("b")];
    const incoming = [make("a"), make("c")];
    const merged = mergeNewOnly(current, incoming);
    expect(merged.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("never overwrites existing entries (scores preserved)", () => {
    const current = [make("a", { score: { manager_approved: 99 } })];
    const incoming = [make("a", { score: { manager_approved: 0 } })];
    const merged = mergeNewOnly(current, incoming);
    expect(merged[0].score.manager_approved).toBe(99);
  });

  it("returns the same array when nothing is new", () => {
    const current = [make("a"), make("b")];
    expect(mergeNewOnly(current, [make("a")])).toHaveLength(2);
  });
});
