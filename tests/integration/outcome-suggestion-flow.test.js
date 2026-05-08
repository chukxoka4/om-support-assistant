// End-to-end: log a draft → set a terminal outcome → assert maybeProposeFromOutcome
// fires the right comparison through proposeSuggestion → suggestion lands in
// the library entry. Verifies the comparison fix (managerial_rewrite uses
// self-edit, not AI output) and idempotency (no double-fire).

import { describe, it, expect, beforeEach, vi } from "vitest";

let lastCallArgs = null;
let llmReply = JSON.stringify({
  summary: "ok",
  proposed_changes: [{ type: "refine_instruction", value: "tighten tone", reason: "manager edit" }]
});

vi.mock("../../providers/index.js", () => ({
  callLLM: vi.fn(async ({ user }) => {
    lastCallArgs = { user };
    return { text: llmReply, provider: "test" };
  })
}));

const { addEntry, getEntry } = await import("../../lib/library.js");
const { maybeProposeFromOutcome, decideProposal } = await import("../../lib/suggestions.js");

const AI = "Hi, thanks for reaching out.";
const SELF = "Hi friend, thanks so much for reaching out — I'll take a look.";
const MGR = "Hi friend! Thanks for the message. I checked your account; here's what I found.";

function entry() {
  return {
    id: "entry-1",
    created_at: "2026-01-01T00:00:00Z",
    source: "seed",
    product: "OptinMonster",
    dropdowns: { goal: "Account Issue", audience: "Frustrated Customer", tone: "Calm", mode: "billing", concise: false },
    scenario_title: "t", scenario_summary: "s", scenario_instruction: "x",
    score: { initial_uses: 1, sent_as_is: 0, manager_approved: 0, rewrites_absorbed: 0 },
    pending_suggestions: []
  };
}

function draft(outcome, overrides = {}) {
  return {
    id: "d-" + outcome,
    library_entry_id: "entry-1",
    output_parsed: { versionA: AI, versionB: null },
    chosen_version: "version-a",
    final_used_verbatim: false,
    final_used_text: SELF,
    manager_rewrite_text: null,
    outcome,
    ...overrides
  };
}

describe("outcome-driven suggestion flow", () => {
  beforeEach(async () => {
    await chrome.storage.local.clear();
    lastCallArgs = null;
    llmReply = JSON.stringify({
      summary: "ok",
      proposed_changes: [{ type: "refine_instruction", value: "tighten tone", reason: "edit" }]
    });
  });

  it("sent → fires self_edit suggestion comparing AI vs self-edit", async () => {
    await addEntry(entry());
    const r = await maybeProposeFromOutcome(draft("sent"));
    expect(r.suggestion).toBeDefined();
    expect(r.suggestion.trigger).toBe("self_edit");
    expect(lastCallArgs.user).toContain(AI);
    expect(lastCallArgs.user).toContain(SELF);
    const e = await getEntry("entry-1");
    expect(e.pending_suggestions).toHaveLength(1);
  });

  it("managerial_rewrite → fires comparing self-edit vs manager rewrite (NOT AI vs manager)", async () => {
    await addEntry(entry());
    const d = draft("managerial_rewrite", { manager_rewrite_text: MGR });
    const r = await maybeProposeFromOutcome(d);
    expect(r.suggestion).toBeDefined();
    expect(r.suggestion.trigger).toBe("managerial_rewrite");
    // Comparison should include the self-edit and the manager text — not the
    // raw AI output. We can assert this by checking the prompt body sent to
    // the LLM mock.
    expect(lastCallArgs.user).toContain(SELF);
    expect(lastCallArgs.user).toContain(MGR);
    // The decision payload itself should carry the self-edit, not AI output.
    const decision = decideProposal(d);
    expect(decision.args.userOutput).toBe(SELF);
    expect(decision.args.finalOutput).toBe(MGR);
  });

  it("no-diff sent (verbatim AI output) → no suggestion, no LLM call", async () => {
    await addEntry(entry());
    const r = await maybeProposeFromOutcome(draft("sent", {
      final_used_verbatim: true, final_used_text: null
    }));
    expect(r.skip).toBe("no_diff");
    expect(lastCallArgs).toBeNull();
    const e = await getEntry("entry-1");
    expect(e.pending_suggestions).toHaveLength(0);
  });

  it("idempotent: second call for same draft does not double-fire", async () => {
    await addEntry(entry());
    await maybeProposeFromOutcome(draft("sent"));
    lastCallArgs = null;
    const second = await maybeProposeFromOutcome(draft("sent"));
    expect(second.skip).toBe("already_pending");
    expect(lastCallArgs).toBeNull();
    const e = await getEntry("entry-1");
    expect(e.pending_suggestions).toHaveLength(1);
  });

  it("draft with no library_entry_id is a no-op", async () => {
    const r = await maybeProposeFromOutcome(draft("sent", { library_entry_id: null }));
    expect(r.skip).toBe("no_library_entry");
  });
});
