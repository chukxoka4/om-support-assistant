import { resolveAction, buildPrompt } from "./prompts.js";
import { callLLM } from "../providers/index.js";
import { sanitizeModelHtml } from "./html.js";
import { logDraft } from "./storage.js";

const HTML_OUTPUT_DIRECTIVE =
  "\n\nOutput format: clean HTML only. Preserve <a>, <strong>, <em>, <br>, <ul>, <ol>, <li>, <p>. " +
  "Do not use markdown. Do not wrap in <html>, <body>, or code fences. Do not include explanations outside the reply.";

export async function compose({
  actionId,
  selectionHtml = "",
  notes = "",
  conversationId = null,
  provider = null
}) {
  const action = await resolveAction(actionId);
  if (!action) return { html: "", error: `Unknown action: ${actionId}` };

  const { system, user } = await buildPrompt(action, {
    selection_html: selectionHtml,
    notes
  });

  const { text, error, provider: usedProvider } = await callLLM({
    provider: provider || action.preferred_provider,
    system: system + HTML_OUTPUT_DIRECTIVE,
    user
  });

  if (error) return { html: "", error };

  const html = sanitizeModelHtml(text);

  const record = {
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    conversation_id: conversationId,
    product: action.product,
    action_id: action.id,
    provider: usedProvider,
    draft_html: html,
    final_sent_html: null,
    correction_logged: false,
    outcome: null
  };
  await logDraft(record);

  return { html, draftId: record.id, provider: usedProvider };
}
