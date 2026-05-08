// Decision logic for the outcome-driven suggestion funnel. Pure module —
// covers each outcome branch, the no-diff guard, and the various skip
// conditions. The side-effecting maybeProposeFromOutcome is exercised via
// the integration test alongside real storage.

import { describe, it, expect } from "vitest";
import { decideProposal } from "../../lib/suggestions.js";

const aiOutput = "Hi! Thanks for reaching out about your account.";
const selfEdit = "Hi friend! Thanks so much for reaching out about your account.";
const managerRewrite = "Hi friend, thanks so much for reaching out — I've checked your account and here's what I found.";

function baseDraft(overrides = {}) {
  return {
    id: "d1",
    library_entry_id: "entry-1",
    output_parsed: { versionA: aiOutput, versionB: null },
    chosen_version: "version-a",
    final_used_verbatim: false,
    final_used_text: selfEdit,
    manager_rewrite_text: null,
    outcome: null,
    ...overrides
  };
}

describe("decideProposal — branches by outcome", () => {
  it("sent: compares AI output → self-edit", () => {
    const r = decideProposal(baseDraft({ outcome: "sent" }));
    expect(r.skip).toBeUndefined();
    expect(r.args.trigger).toBe("self_edit");
    expect(r.args.userOutput).toBe(aiOutput);
    expect(r.args.finalOutput).toBe(selfEdit);
  });

  it("manager_approved: same comparison as sent (manager confirmed your edit)", () => {
    const r = decideProposal(baseDraft({ outcome: "manager_approved" }));
    expect(r.args.trigger).toBe("self_edit");
    expect(r.args.userOutput).toBe(aiOutput);
    expect(r.args.finalOutput).toBe(selfEdit);
  });

  it("managerial_rewrite: compares self-edit (what was sent) → manager rewrite", () => {
    const r = decideProposal(baseDraft({
      outcome: "managerial_rewrite",
      manager_rewrite_text: managerRewrite
    }));
    expect(r.args.trigger).toBe("managerial_rewrite");
    expect(r.args.userOutput).toBe(selfEdit); // NOT aiOutput
    expect(r.args.finalOutput).toBe(managerRewrite);
  });

  it("managerial_rewrite with no self-edit falls back to AI output as the 'sent' side", () => {
    const r = decideProposal(baseDraft({
      outcome: "managerial_rewrite",
      manager_rewrite_text: managerRewrite,
      final_used_verbatim: true,
      final_used_text: null
    }));
    expect(r.args.userOutput).toBe(aiOutput);
    expect(r.args.finalOutput).toBe(managerRewrite);
  });
});

describe("decideProposal — skip conditions", () => {
  it("skips when there is no library_entry_id", () => {
    expect(decideProposal(baseDraft({ outcome: "sent", library_entry_id: null })).skip)
      .toBe("no_library_entry");
  });

  it("skips for non-terminal outcomes", () => {
    expect(decideProposal(baseDraft({ outcome: null })).skip).toBe("non_terminal_outcome");
    expect(decideProposal(baseDraft({ outcome: "dismissed" })).skip).toBe("non_terminal_outcome");
  });

  it("skips when sent matches AI output verbatim (no self-edit)", () => {
    const r = decideProposal(baseDraft({
      outcome: "sent",
      final_used_verbatim: true,
      final_used_text: null
    }));
    expect(r.skip).toBe("no_diff");
  });

  it("skips when self-edit is only whitespace/HTML noise vs AI output", () => {
    const r = decideProposal(baseDraft({
      outcome: "sent",
      final_used_text: `<p>${aiOutput}</p>`
    }));
    expect(r.skip).toBe("no_diff");
  });

  it("skips managerial_rewrite when manager_rewrite_text is empty", () => {
    const r = decideProposal(baseDraft({
      outcome: "managerial_rewrite",
      manager_rewrite_text: ""
    }));
    expect(r.skip).toBe("no_manager_text");
  });

  it("skips when there is no draft", () => {
    expect(decideProposal(null).skip).toBe("no_draft");
  });
});
