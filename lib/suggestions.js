// Suggestions service: compare user AI output vs the human-corrected text and
// propose library refinements. Fire-and-forget — surfaces in the review queue.
//
// Triggers fire on outcome confirmation, not on send. The two texts compared
// depend on which outcome the draft transitioned into:
//   sent / manager_approved → AI output vs your self-edit (final_used_text)
//   managerial_rewrite      → your self-edit vs the manager's rewrite
//
// "Self-edit" falls back to the AI output when the user marked the draft as
// "verbatim" — there's nothing to compare against in that case and the
// no-diff guard short-circuits cleanly.

import { callLLM } from "../providers/index.js";
import { addSuggestion, getEntry } from "./library.js";
import { isMeaningfulDiff } from "./diff-text.js";

const SYSTEM = `You are a library curator for a customer-support prompt library.
Given an AI-generated reply and the human-corrected final version that was actually sent, propose concrete, small changes to improve the stored prompt.

Rules:
- Do NOT rewrite the whole prompt. Suggest small, specific changes.
- Suggestions must be actionable: a new tone value to add, a new audience value, a refined scenario instruction, or a new scenario worth splitting into its own entry.
- Use this exact JSON output shape (no prose before or after):

{
  "summary": "one-line description of what changed",
  "proposed_changes": [
    { "type": "refine_instruction" | "new_tone" | "new_audience" | "new_goal" | "split_entry", "value": "...", "reason": "..." }
  ]
}

If nothing meaningful changed (minor typo fixes, etc.), return:
{ "summary": "No structural change — minor wording only.", "proposed_changes": [] }`;

export async function proposeSuggestion({ entryId, draftId, userOutput, finalOutput, trigger }) {
  const user = `AI-generated reply:\n${userOutput || "(empty)"}\n\n---\n\nHuman-corrected final sent:\n${finalOutput || "(empty)"}`;
  const { text, error } = await callLLM({ system: SYSTEM, user });
  if (error) {
    console.warn("proposeSuggestion: LLM call failed", error);
    return { error };
  }

  let analysis;
  try {
    const match = text.match(/\{[\s\S]*\}/);
    analysis = JSON.parse(match ? match[0] : text);
  } catch (e) {
    analysis = { summary: "Could not parse suggestion.", proposed_changes: [], raw: text };
  }

  const suggestion = {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    trigger,
    draft_id: draftId,
    user_output: userOutput,
    final_output: finalOutput,
    ai_analysis: analysis,
    status: "pending"
  };
  await addSuggestion(entryId, suggestion);
  return { suggestion };
}

// What text actually went out the door? Self-edit when the user pasted one,
// else the AI output. Used as either side of the comparison depending on
// outcome.
function selfEditOrAi(draft) {
  const ai = chosenAiOutput(draft);
  const edit = draft?.final_used_verbatim === false && String(draft?.final_used_text || "").trim()
    ? String(draft.final_used_text || "").trim()
    : null;
  return edit || ai;
}

function chosenAiOutput(draft) {
  const versionKey = draft?.chosen_version || "version-a";
  const parsed = draft?.output_parsed;
  return parsed?.[versionKey === "version-b" ? "versionB" : "versionA"]
      || draft?.output_raw
      || "";
}

// Funnel: called whenever a draft transitions into a terminal outcome.
// Branches on outcome to pick the right comparison; skips trivial diffs;
// no-ops if the draft has no library entry or has already produced a
// pending suggestion.
//
// Pure storage-shape function — takes the live draft list and returns
// either the proposeSuggestion args (so callers can fire it) or a skip
// reason. Splitting the decision from the side-effect makes this trivially
// testable.
export function decideProposal(draft) {
  if (!draft) return { skip: "no_draft" };
  if (!draft.library_entry_id) return { skip: "no_library_entry" };
  const outcome = draft.outcome;
  if (outcome !== "sent" && outcome !== "manager_approved" && outcome !== "managerial_rewrite") {
    return { skip: "non_terminal_outcome" };
  }

  let userOutput;
  let finalOutput;
  let trigger;
  if (outcome === "managerial_rewrite") {
    // What's "user output" here is what the agent actually sent (their self-
    // edit if any, else the AI output). What's "final" is what the manager
    // changed it to. The lesson lives in that delta.
    const sent = selfEditOrAi(draft);
    const managerFinal = String(draft.manager_rewrite_text || "").trim();
    if (!managerFinal) return { skip: "no_manager_text" };
    userOutput = sent;
    finalOutput = managerFinal;
    trigger = "managerial_rewrite";
  } else {
    // sent / manager_approved: compare AI output → what actually went out
    // (the agent's self-edit, or the AI output verbatim).
    const ai = chosenAiOutput(draft);
    const final = selfEditOrAi(draft);
    userOutput = ai;
    finalOutput = final;
    trigger = "self_edit";
  }

  if (!isMeaningfulDiff(userOutput, finalOutput)) {
    return { skip: "no_diff" };
  }

  return {
    args: {
      entryId: draft.library_entry_id,
      draftId: draft.id,
      userOutput,
      finalOutput,
      trigger
    }
  };
}

// Convenience side-effecting wrapper. Fire-and-forget; failures get warned.
export async function maybeProposeFromOutcome(draft) {
  const decision = decideProposal(draft);
  if (decision.skip) return decision;
  // Idempotency: if a pending suggestion already exists for this draft,
  // don't double-fire. Cheap check against the entry's queue.
  if (draft.library_entry_id) {
    const entry = await getEntry(draft.library_entry_id);
    const dup = (entry?.pending_suggestions || []).some(
      (s) => s.draft_id === draft.id && (s.status === "pending" || s.status === "needs_manual")
    );
    if (dup) return { skip: "already_pending" };
  }
  return proposeSuggestion(decision.args);
}
