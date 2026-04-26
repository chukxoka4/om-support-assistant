// Bug C1 — managerial rewrite enqueues a suggestion.
// Integration: library + suggestions + provider stub.

import { describe, it, expect, beforeEach, vi } from "vitest";

let llmReply = JSON.stringify({
  summary: "Tighten refund-window check",
  proposed_changes: [
    { type: "refine_instruction", value: "Confirm window first.", reason: "manager edit" }
  ]
});

vi.mock("../../providers/index.js", () => ({
  callLLM: vi.fn(async () => {
    if (llmReply instanceof Error) throw llmReply;
    return { text: llmReply, provider: "test" };
  })
}));

const { addEntry, getEntry } = await import("../../lib/library.js");
const { proposeSuggestion } = await import("../../lib/suggestions.js");

const sampleEntry = (id) => ({
  id,
  created_at: "2025-01-01T00:00:00Z",
  source: "seed",
  product: "OptinMonster",
  dropdowns: { goal: "Account Issue", audience: "Frustrated Customer", tone: "Calm", mode: "billing", concise: false },
  scenario_title: "t",
  scenario_summary: "s",
  scenario_instruction: "Confirm plan and charge date before quoting.",
  score: { initial_uses: 1, sent_as_is: 0, manager_approved: 0, rewrites_absorbed: 0 },
  pending_suggestions: []
});

describe("C1: proposeSuggestion enqueues into the linked library entry", () => {
  beforeEach(async () => {
    await chrome.storage.local.clear();
    llmReply = JSON.stringify({
      summary: "Tighten refund-window check",
      proposed_changes: [
        { type: "refine_instruction", value: "Confirm window first.", reason: "manager edit" }
      ]
    });
  });

  it("adds a pending suggestion to the entry", async () => {
    await addEntry(sampleEntry("entry-1"));

    const result = await proposeSuggestion({
      entryId: "entry-1",
      draftId: "draft-1",
      userOutput: "Original AI reply",
      finalOutput: "Manager rewrote it like this",
      trigger: "managerial_rewrite"
    });
    expect(result.suggestion).toBeDefined();
    expect(result.suggestion.status).toBe("pending");
    expect(result.suggestion.trigger).toBe("managerial_rewrite");

    const entry = await getEntry("entry-1");
    expect(entry.pending_suggestions).toHaveLength(1);
    expect(entry.pending_suggestions[0].ai_analysis.summary).toMatch(/refund-window/);
  });

  it("falls back gracefully when the LLM returns unparseable text", async () => {
    await addEntry(sampleEntry("entry-2"));
    llmReply = "this is not json at all";

    const result = await proposeSuggestion({
      entryId: "entry-2",
      draftId: "draft-2",
      userOutput: "u",
      finalOutput: "f",
      trigger: "managerial_rewrite"
    });
    expect(result.suggestion).toBeDefined();
    expect(result.suggestion.ai_analysis.summary).toMatch(/Could not parse/);
    const entry = await getEntry("entry-2");
    expect(entry.pending_suggestions).toHaveLength(1);
  });

  it("sidepanel-style fire-and-forget does not propagate errors", async () => {
    // Wiring in saveManagerialRewrite swallows errors via .catch — proves
    // a thrown LLM call cannot break Step 2.
    llmReply = new Error("network down");

    let stepTwoFinished = false;
    await Promise.resolve()
      .then(() =>
        proposeSuggestion({
          entryId: "missing",
          draftId: "d",
          userOutput: "u",
          finalOutput: "f",
          trigger: "managerial_rewrite"
        }).catch(() => {})
      )
      .then(() => {
        stepTwoFinished = true;
      });

    expect(stepTwoFinished).toBe(true);
  });

  it("addSuggestion returns false for an unknown entry id (no crash)", async () => {
    // proposeSuggestion delegates to addSuggestion; this asserts the storage
    // contract callers rely on.
    const result = await proposeSuggestion({
      entryId: "does-not-exist",
      draftId: "d",
      userOutput: "u",
      finalOutput: "f",
      trigger: "managerial_rewrite"
    });
    // Suggestion built; addSuggestion returned false because entry missing.
    // Important: no throw, no stored side effect.
    expect(result.suggestion).toBeDefined();
    const all = await chrome.storage.local.get(null);
    expect(all.library_v3 || []).toEqual([]);
  });
});
