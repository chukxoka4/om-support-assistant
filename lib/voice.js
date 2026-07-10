// Voice envelope: role + house style + output contract.
// Inherited by every library entry at runtime — not stored per-entry.

import { getHouseStyle, getProductRole } from "./prompts.js";

const OUTPUT_CONTRACT = `
Output contract:
- Clarity is King: Short paragraphs.
- Formatting: Use bullet points where helpful.
- Branding: spell the product name correctly.
- DOCUMENTATION: if "Official Documentation" is provided, you MUST incorporate the links where relevant.
- NO LaTeX, no markdown code fences, no <html> or <body> wrappers.

You MUST reply using exactly this structure, with these labels on their own lines:

REASON:
[Brief explanation of changes or approach — 1-3 short sentences.]

VERSION A (The Polish):
[Refined version of the draft. Keep the customer's original intent but improve clarity, tone, and structure.]

VERSION B (The Revamp):
[Reimagined version incorporating any documentation links or fresh angles that would improve the outcome.]
`;

// DEC-F: the KB reasoning layer. Phrased conditionally so it is harmless when
// no tools / no knowledge base are present (transform fallback, HTTP providers)
// — in that case the model simply answers normally and never mentions the KB.
const KB_REASONING = `
Local knowledge base (use ONLY if available):
If you have file-search tools (Grep, Glob, Read) and a knowledge base is present in your working directory, then BEFORE drafting:
- Grep patterns/INDEX.md for the customer's symptom or the exact error string, then Read the matching patterns/<area>.md section(s).
- Prefer a verified pattern (its Symptom / Cause / Fix / Verify) over general knowledge, and cite that pattern's documentation URL in your reply when you use it.
- You may also scan drafts/ for a closely matching past ticket.
If you do NOT have those tools or no knowledge base is present, ignore this section entirely and answer normally — do not mention a knowledge base.
`;

const LIBRARY_TASK = `
After the three versions above, append two more labelled sections so this reply can be studied later:

CLEAN_PROMPT:
[A clean, reusable instruction an agent could apply next time the same scenario appears. Anonymised — no customer names, ticket numbers, or URLs. State the scenario pattern and what the reply should emphasise. One paragraph.]

SCENARIO_SUMMARY:
[One sentence describing when this prompt should be used. Anonymised.]
`;

export async function buildVoiceEnvelope({ product }) {
  const role = getProductRole(product);
  const houseStyle = await getHouseStyle();
  return `
Role: ${role}.

House style (always apply):
${houseStyle}

${OUTPUT_CONTRACT}
`.trim();
}

export async function buildSystemPrompt({ product, scenarioInstruction, dropdowns, concise, includeLibraryTask = true, includeKbReasoning = false }) {
  const envelope = await buildVoiceEnvelope({ product });
  const { goal, audience, tone, mode } = dropdowns || {};
  const contextBlock = `
Context for this reply:
- Product: ${product}
- Goal: ${goal || "—"}
- Audience: ${audience || "—"}
- Tone: ${tone || "—"}
- Mode: ${mode || "—"}
${concise ? "- Conciseness required: keep sentences short, minimal filler, no repetition." : ""}
`.trim();

  const scenarioBlock = scenarioInstruction
    ? `\nScenario instruction:\n${scenarioInstruction}`
    : "";

  const kbBlock = includeKbReasoning ? "\n\n" + KB_REASONING.trim() : "";

  return `${envelope}\n\n${contextBlock}${scenarioBlock}${kbBlock}${includeLibraryTask ? "\n\n" + LIBRARY_TASK : ""}`.trim();
}
