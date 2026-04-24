// Suggestions service: compare user AI output vs Erica's corrected final,
// propose library refinements. Fire-and-forget — surfaces in review queue.

import { callLLM } from "../providers/index.js";
import { addSuggestion } from "./library.js";

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
  if (error) return { error };

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
