/** Plain-text assistant reply for the version last chosen / delivered on a draft record. */
export function chosenAssistantReply(draft) {
  const versionKey = draft.chosen_version || "version-a";
  return draft.output_parsed?.[versionKey === "version-b" ? "versionB" : "versionA"] || draft.draft_input || "";
}

/** Step 2 “what we’re judging” body: your pasted Step 1 text when edited, else the assistant reply. */
export function step2PreviewFromDraft(draft) {
  if (!draft) return "";
  if (draft.final_used_verbatim === false && String(draft.final_used_text || "").trim()) {
    return String(draft.final_used_text || "").trim();
  }
  return chosenAssistantReply(draft);
}
