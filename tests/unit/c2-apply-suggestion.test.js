// Bug C2 — Suggestion accept opens preview; Apply mutates the entry.
// Reject / Defer / Cancel never mutate. split_entry is flagged needs_manual.

import { describe, it, expect, beforeEach } from "vitest";
import {
  addEntry,
  getEntry,
  addSuggestion,
  applySuggestion,
  resolveSuggestion,
  getAllPendingSuggestions
} from "../../lib/library.js";
import { getTaxonomy } from "../../lib/storage.js";

const baseEntry = (id) => ({
  id,
  created_at: "2025-01-01T00:00:00Z",
  source: "seed",
  product: "OptinMonster",
  dropdowns: { goal: "Account Issue", audience: "Frustrated Customer", tone: "Calm", mode: "billing", concise: false },
  scenario_title: "Refund — within window",
  scenario_summary: "Standard refund handling",
  scenario_instruction: "Confirm plan and charge date before quoting any refund amount.",
  score: { initial_uses: 1, sent_as_is: 0, manager_approved: 0, rewrites_absorbed: 0 },
  pending_suggestions: []
});

const buildSuggestion = (id, change) => ({
  id,
  created_at: "2025-01-02T00:00:00Z",
  trigger: "managerial_rewrite",
  draft_id: "d-1",
  user_output: "u",
  final_output: "f",
  ai_analysis: { summary: "test", proposed_changes: [change] },
  status: "pending"
});

describe("applySuggestion: refine_instruction", () => {
  beforeEach(async () => chrome.storage.local.clear());

  it("replaces scenario_instruction, marks applied, increments rewrites_absorbed", async () => {
    await addEntry(baseEntry("e1"));
    await addSuggestion("e1", buildSuggestion("s1", {
      type: "refine_instruction",
      value: "Confirm plan, charge date, AND refund window before quoting.",
      reason: "manager added eligibility check"
    }));

    const result = await applySuggestion("e1", "s1");
    expect(result.applied).toBe(1);
    expect(result.status).toBe("applied");
    expect(result.changes[0].type).toBe("refine_instruction");

    const entry = await getEntry("e1");
    expect(entry.scenario_instruction).toMatch(/refund window/);
    expect(entry.score.rewrites_absorbed).toBe(1);
    expect(entry.pending_suggestions[0].status).toBe("applied");
    expect(entry.pending_suggestions[0].resolved_at).toBeTruthy();
  });

  it("two applies stack the rewrites_absorbed counter", async () => {
    await addEntry(baseEntry("e1"));
    await addSuggestion("e1", buildSuggestion("s1", { type: "refine_instruction", value: "v1", reason: "" }));
    await addSuggestion("e1", buildSuggestion("s2", { type: "refine_instruction", value: "v2", reason: "" }));
    await applySuggestion("e1", "s1");
    await applySuggestion("e1", "s2");
    const entry = await getEntry("e1");
    expect(entry.score.rewrites_absorbed).toBe(2);
    expect(entry.scenario_instruction).toBe("v2");
  });
});

describe("applySuggestion: multiple proposed_changes (the real-world case)", () => {
  beforeEach(async () => chrome.storage.local.clear());

  const buildMulti = (id, changes) => ({
    id,
    created_at: "2025-01-02T00:00:00Z",
    trigger: "managerial_rewrite",
    draft_id: "d-1",
    user_output: "u",
    final_output: "f",
    ai_analysis: { summary: "test", proposed_changes: changes },
    status: "pending"
  });

  it("applies every change in order; last refine wins; all refines count", async () => {
    await addEntry(baseEntry("e1"));
    await addSuggestion("e1", buildMulti("s1", [
      { type: "refine_instruction", value: "first refine", reason: "a" },
      { type: "new_goal", value: "Roadmap Question", reason: "b" },
      { type: "refine_instruction", value: "second refine", reason: "c" },
      { type: "refine_instruction", value: "third (winning) refine", reason: "d" }
    ]));

    const result = await applySuggestion("e1", "s1");
    expect(result.applied).toBe(4);
    expect(result.status).toBe("applied");

    const entry = await getEntry("e1");
    expect(entry.scenario_instruction).toBe("third (winning) refine");
    expect(entry.score.rewrites_absorbed).toBe(3); // three refines absorbed
    const tax = await getTaxonomy();
    expect(tax.goals).toContain("Roadmap Question");
    expect(entry.pending_suggestions[0].status).toBe("applied");
  });

  it("when split_entry is mixed with other changes, others apply and status flips needs_manual", async () => {
    await addEntry(baseEntry("e1"));
    await addSuggestion("e1", buildMulti("s1", [
      { type: "refine_instruction", value: "refined", reason: "" },
      { type: "new_tone", value: "Cheeky", reason: "" },
      { type: "split_entry", value: "Separate VAT cases", reason: "policy split" }
    ]));

    const result = await applySuggestion("e1", "s1");
    expect(result.applied).toBe(2);
    expect(result.status).toBe("needs_manual");
    expect(result.skipped.map((s) => s.type)).toEqual(["split_entry"]);

    const entry = await getEntry("e1");
    expect(entry.scenario_instruction).toBe("refined");
    const tax = await getTaxonomy();
    expect(tax.tones).toContain("Cheeky");
    expect(entry.pending_suggestions[0].status).toBe("needs_manual");
  });

  it("skips unknown change types and reports them in skipped[]", async () => {
    await addEntry(baseEntry("e1"));
    await addSuggestion("e1", buildMulti("s1", [
      { type: "refine_instruction", value: "ok", reason: "" },
      { type: "wat", value: "huh", reason: "" }
    ]));
    const result = await applySuggestion("e1", "s1");
    expect(result.applied).toBe(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].type).toBe("wat");
  });
});

describe("applySuggestion: taxonomy expansions", () => {
  beforeEach(async () => chrome.storage.local.clear());

  it("new_tone adds the value to taxonomy.tones and marks applied", async () => {
    await addEntry(baseEntry("e1"));
    await addSuggestion("e1", buildSuggestion("s1", { type: "new_tone", value: "Cheeky", reason: "" }));
    const result = await applySuggestion("e1", "s1");
    expect(result.applied).toBe(1);
    expect(result.status).toBe("applied");
    const tax = await getTaxonomy();
    expect(tax.tones).toContain("Cheeky");
    const entry = await getEntry("e1");
    expect(entry.pending_suggestions[0].status).toBe("applied");
  });

  it("new_audience and new_goal route to the right taxonomy fields", async () => {
    await addEntry(baseEntry("e1"));
    await addSuggestion("e1", buildSuggestion("s1", { type: "new_audience", value: "Power User", reason: "" }));
    await addSuggestion("e1", buildSuggestion("s2", { type: "new_goal", value: "Roadmap Question", reason: "" }));
    await applySuggestion("e1", "s1");
    await applySuggestion("e1", "s2");
    const tax = await getTaxonomy();
    expect(tax.audiences).toContain("Power User");
    expect(tax.goals).toContain("Roadmap Question");
  });
});

describe("applySuggestion: split_entry surfaces as manual handoff", () => {
  beforeEach(async () => chrome.storage.local.clear());

  it("does not mutate the entry; marks status: needs_manual", async () => {
    await addEntry(baseEntry("e1"));
    const beforeInstruction = baseEntry("e1").scenario_instruction;
    await addSuggestion("e1", buildSuggestion("s1", {
      type: "split_entry",
      value: "Separate VAT-inclusive cases",
      reason: "different policy"
    }));
    const result = await applySuggestion("e1", "s1");
    expect(result.applied).toBe(0);
    expect(result.status).toBe("needs_manual");
    const entry = await getEntry("e1");
    expect(entry.scenario_instruction).toBe(beforeInstruction);
    expect(entry.pending_suggestions[0].status).toBe("needs_manual");
  });
});

describe("Reject / Defer / Cancel never mutate", () => {
  beforeEach(async () => chrome.storage.local.clear());

  it("resolveSuggestion(rejected) leaves scenario_instruction untouched", async () => {
    await addEntry(baseEntry("e1"));
    await addSuggestion("e1", buildSuggestion("s1", { type: "refine_instruction", value: "should not land", reason: "" }));
    await resolveSuggestion("e1", "s1", "rejected");
    const entry = await getEntry("e1");
    expect(entry.scenario_instruction).toMatch(/charge date before quoting/);
    expect(entry.score.rewrites_absorbed).toBeFalsy();
    expect(entry.pending_suggestions[0].status).toBe("rejected");
  });

  it("deferred leaves the suggestion out of the visible queue but not applied", async () => {
    await addEntry(baseEntry("e1"));
    await addSuggestion("e1", buildSuggestion("s1", { type: "refine_instruction", value: "later", reason: "" }));
    await resolveSuggestion("e1", "s1", "deferred");
    const queue = await getAllPendingSuggestions();
    expect(queue).toHaveLength(0);
    const entry = await getEntry("e1");
    expect(entry.scenario_instruction).toMatch(/charge date before quoting/);
  });
});

describe("error paths", () => {
  beforeEach(async () => chrome.storage.local.clear());

  it("returns applied:0 for unknown entry", async () => {
    const r = await applySuggestion("nope", "s1");
    expect(r.applied).toBe(0);
    expect(r.error).toMatch(/entry not found/);
  });

  it("returns applied:0 for unknown suggestion id", async () => {
    await addEntry(baseEntry("e1"));
    const r = await applySuggestion("e1", "ghost");
    expect(r.applied).toBe(0);
    expect(r.error).toMatch(/suggestion not found/);
  });

  it("returns applied:0 when proposed_changes is empty", async () => {
    await addEntry(baseEntry("e1"));
    await addSuggestion("e1", {
      id: "s1",
      created_at: "x",
      trigger: "managerial_rewrite",
      ai_analysis: { summary: "no changes", proposed_changes: [] },
      status: "pending"
    });
    const r = await applySuggestion("e1", "s1");
    expect(r.applied).toBe(0);
    expect(r.error).toMatch(/no proposed change/);
  });
});

describe("getAllPendingSuggestions surfaces needs_manual", () => {
  beforeEach(async () => chrome.storage.local.clear());

  it("includes both pending and needs_manual suggestions", async () => {
    await addEntry(baseEntry("e1"));
    await addSuggestion("e1", buildSuggestion("s1", { type: "refine_instruction", value: "v", reason: "" }));
    await addSuggestion("e1", buildSuggestion("s2", { type: "split_entry", value: "x", reason: "" }));
    // Apply split_entry → flips s2 to needs_manual; should still surface.
    await applySuggestion("e1", "s2");
    const queue = await getAllPendingSuggestions();
    expect(queue).toHaveLength(2);
    const statuses = queue.map((q) => q.suggestion.status).sort();
    expect(statuses).toEqual(["needs_manual", "pending"]);
  });
});
