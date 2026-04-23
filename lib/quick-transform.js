// Service: quick in-place transforms (retone + translate) on selected HTML.
// Single-output flow — not the compose pipeline.

import { callLLM } from "../providers/index.js";

export const RETONE_ACTIONS = {
  fix:          { label: "Fix Spelling and Grammar", instruction: "Fix spelling, grammar, and punctuation. Keep the original meaning, tone, and structure." },
  longer:       { label: "Make Text Longer",         instruction: "Expand the text with helpful detail and context. Keep the original intent." },
  shorter:      { label: "Make Text Shorter",        instruction: "Tighten the text. Remove filler and redundancy. Keep the key message." },
  friendlier:   { label: "Make Tone Friendlier",     instruction: "Rewrite in a warmer, friendlier tone. Keep it professional." },
  professional: { label: "Make Tone More Professional", instruction: "Rewrite in a polished, professional tone." },
  direct:       { label: "Make Tone More Direct",    instruction: "Rewrite in a clearer, more direct tone. Remove hedging." },
  calm:         { label: "Make Tone Calmer",         instruction: "Rewrite in a calm, reassuring tone. De-escalate any urgency." }
};

export const LANGUAGES = [
  { id: "zh", name: "Chinese" },
  { id: "es", name: "Spanish" },
  { id: "hi", name: "Hindi" },
  { id: "ar", name: "Arabic" },
  { id: "pt", name: "Portuguese" },
  { id: "bn", name: "Bengali" },
  { id: "ru", name: "Russian" },
  { id: "ja", name: "Japanese" },
  { id: "pa", name: "Punjabi" },
  { id: "de", name: "German" },
  { id: "jv", name: "Javanese" },
  { id: "ko", name: "Korean" },
  { id: "fr", name: "French" },
  { id: "te", name: "Telugu" },
  { id: "mr", name: "Marathi" },
  { id: "tr", name: "Turkish" },
  { id: "ta", name: "Tamil" },
  { id: "vi", name: "Vietnamese" },
  { id: "ur", name: "Urdu" },
  { id: "it", name: "Italian" },
  { id: "fi", name: "Finnish" },
  { id: "en", name: "English" }
];

const SYSTEM_BASE = `You are a precise text transformer.
- Preserve ALL original HTML formatting (bold, italics, links, headings, lists, line breaks).
- Do NOT wrap output in <html>, <body>, or <div> wrappers.
- Do NOT add commentary, labels, or explanations.
- Output ONLY the transformed HTML.`;

function sanitize(html) {
  if (!html) return "";
  return html
    .replace(/^<html[^>]*>/i, "")
    .replace(/<\/html>$/i, "")
    .replace(/^<body[^>]*>/i, "")
    .replace(/<\/body>$/i, "")
    .trim();
}

export async function retone(actionId, html, provider = null) {
  const action = RETONE_ACTIONS[actionId];
  if (!action) return { error: `Unknown action: ${actionId}` };
  const system = `${SYSTEM_BASE}\n\nTask: ${action.instruction}`;
  const user = `HTML to transform:\n\n${html}`;
  const result = await callLLM({ provider, system, user });
  if (result.error) return result;
  return { text: sanitize(result.text), provider: result.provider };
}

export async function translate(languageName, html, provider = null) {
  const system = `${SYSTEM_BASE}\n\nTask: Translate the HTML to ${languageName}. Preserve all formatting and links exactly.`;
  const user = `HTML to translate:\n\n${html}`;
  const result = await callLLM({ provider, system, user });
  if (result.error) return result;
  return { text: sanitize(result.text), provider: result.provider };
}
