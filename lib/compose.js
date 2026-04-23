import { getHouseStyle, getProductDoc, getProductRole } from "./prompts.js";
import { callLLM } from "../providers/index.js";
import { logDraft } from "./storage.js";

const OUTPUT_INSTRUCTIONS = `
You MUST reply using exactly this structure, with these exact labels on their own lines:

REASON:
[Brief explanation of changes or approach — 1-3 short sentences.]

VERSION A (The Polish):
[Refined version of the draft. Keep the customer's original intent but improve clarity, tone, and structure.]

VERSION B (The Revamp):
[Reimagined version incorporating any documentation links or fresh angles that would improve the outcome.]

Formatting rules:
- Short paragraphs. Bullet points where lists help.
- No LaTeX, no markdown code fences, no <html> or <body> wrappers.
- Plain text output with blank lines between paragraphs is fine; the UI will format it.
`;

function buildSystemPrompt({ product, goal, mode, audience, tone, concise, houseStyle, productDoc }) {
  const role = getProductRole(product);
  return `
Role: ${role}.
Objective: Rewrite or write a customer support reply based on the draft and constraints.

Context:
- Product: ${product}
- Goal: ${goal}
- Mode: ${mode}
- Audience: ${audience}
- Tone: ${tone}
${concise ? "- Conciseness required: keep sentences short, minimal filler, no repetition.\n" : ""}

House style (always apply):
${houseStyle}

Product reference:
${productDoc}

${OUTPUT_INSTRUCTIONS}
`.trim();
}

function buildUserPrompt({ draft, promptExtra, searchResults }) {
  const parts = [];
  if (draft?.trim()) parts.push(`Draft / customer message:\n${draft.trim()}`);
  if (promptExtra?.trim()) parts.push(`Extra context from agent:\n${promptExtra.trim()}`);
  if (searchResults?.trim()) {
    parts.push(
      `OFFICIAL DOCUMENTATION FOUND — incorporate relevant links into the reply:\n${searchResults.trim()}`
    );
  }
  return parts.join("\n\n") || "(no draft provided)";
}

export function parseStructuredOutput(raw) {
  if (!raw) return { reason: "", versionA: "", versionB: "", raw: "" };
  const text = raw.replace(/\r\n/g, "\n");
  const reasonMatch = text.match(/REASON:\s*([\s\S]*?)(?=\n\s*VERSION A|$)/i);
  const versionAMatch = text.match(/VERSION A[^\n:]*:\s*([\s\S]*?)(?=\n\s*VERSION B|$)/i);
  const versionBMatch = text.match(/VERSION B[^\n:]*:\s*([\s\S]*?)$/i);
  return {
    reason: (reasonMatch?.[1] || "").trim(),
    versionA: (versionAMatch?.[1] || "").trim(),
    versionB: (versionBMatch?.[1] || "").trim(),
    raw: text
  };
}

export async function compose({
  product,
  draft,
  promptExtra,
  goal,
  mode,
  audience,
  tone,
  concise,
  provider = null,
  searchResults = "",
  conversationId = null,
  templateId = null
}) {
  const [houseStyle, productDoc] = await Promise.all([getHouseStyle(), getProductDoc(product)]);
  const system = buildSystemPrompt({ product, goal, mode, audience, tone, concise, houseStyle, productDoc });
  const user = buildUserPrompt({ draft, promptExtra, searchResults });

  const { text, error, provider: usedProvider } = await callLLM({ provider, system, user });
  if (error) return { error };

  const parsed = parseStructuredOutput(text);

  const record = {
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    conversation_id: conversationId,
    product,
    goal,
    mode,
    audience,
    tone,
    concise: !!concise,
    template_id: templateId,
    provider: usedProvider,
    draft_input: draft || "",
    output_raw: text,
    output_parsed: parsed,
    final_sent_html: null,
    correction_logged: false,
    outcome: null
  };
  await logDraft(record);

  return { parsed, raw: text, draftId: record.id, provider: usedProvider };
}
