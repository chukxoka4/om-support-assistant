import { getProductDoc } from "./prompts.js";
import { buildSystemPrompt } from "./voice.js";
import { callLLM } from "../providers/index.js";
import { logDraft } from "./storage.js";
import { addEntry, bumpScore, findEquivalent, getEntry } from "./library.js";

function buildUserPrompt({ draft, promptExtra, searchResults, productDoc, customerContext }) {
  const parts = [];
  if (productDoc) parts.push(`Product reference:\n${productDoc}`);
  if (customerContext && customerContext.trim()) {
    parts.push(`Customer context (Intercom):\n${customerContext.trim()}`);
  }
  if (draft?.trim()) parts.push(`Draft / customer message:\n${draft.trim()}`);
  if (promptExtra?.trim()) parts.push(`Extra context from agent:\n${promptExtra.trim()}`);
  if (searchResults?.trim()) {
    parts.push(`OFFICIAL DOCUMENTATION FOUND — incorporate relevant links into the reply:\n${searchResults.trim()}`);
  }
  return parts.join("\n\n") || "(no draft provided)";
}

// Cheap PII guard for auto-generated library entries. The system prompt asks
// the model to anonymise; this verifies. Catches the high-signal patterns
// (email, ticket ref, URL) and is honest about not catching proper nouns —
// detecting customer names without false-positives needs an NLP model.
const PII_PATTERNS = [
  { name: "email", re: /\S+@\S+\.\S+/ },
  { name: "ticket_ref", re: /#\d{4,}/ },
  { name: "url", re: /https?:\/\//i }
];

export function detectPII(...texts) {
  const blob = texts.filter(Boolean).join("\n");
  const hits = [];
  for (const { name, re } of PII_PATTERNS) {
    if (re.test(blob)) hits.push(name);
  }
  return hits;
}

export function parseStructuredOutput(raw) {
  if (!raw) {
    return {
      reason: "", versionA: "", versionB: "", cleanPrompt: "", scenarioSummary: "",
      raw: "", wasParsed: false
    };
  }
  const text = raw.replace(/\r\n/g, "\n");
  const grab = (re) => (text.match(re)?.[1] || "").trim();
  const reason = grab(/REASON:\s*([\s\S]*?)(?=\n\s*VERSION A|$)/i);
  const versionA = grab(/VERSION A[^\n:]*:\s*([\s\S]*?)(?=\n\s*VERSION B|$)/i);
  const versionB = grab(/VERSION B[^\n:]*:\s*([\s\S]*?)(?=\n\s*CLEAN_PROMPT|$)/i);
  const cleanPrompt = grab(/CLEAN_PROMPT:\s*([\s\S]*?)(?=\n\s*SCENARIO_SUMMARY|$)/i);
  const scenarioSummary = grab(/SCENARIO_SUMMARY:\s*([\s\S]*?)$/i);

  const wasParsed = !!(versionA || versionB || reason);

  if (!wasParsed) {
    // The model drifted off the labelled format. Surface the raw text in
    // versionA so the user sees the answer instead of empty boxes; flag
    // wasParsed:false so the UI can show a "couldn't parse" banner.
    return {
      reason: "Model output didn't match expected format. Showing raw response.",
      versionA: text.trim(),
      versionB: "",
      cleanPrompt: "",
      scenarioSummary: "",
      raw: text,
      wasParsed: false
    };
  }

  return { reason, versionA, versionB, cleanPrompt, scenarioSummary, raw: text, wasParsed: true };
}

export async function compose({
  product, draft, promptExtra, goal, mode, audience, tone, concise,
  provider = null, searchResults = "",
  conversationId = null, ticketUrl = null,
  libraryEntryId = null, rewriteOf = null,
  suggestionLog = null,
  customerContext = null
}) {
  let scenarioInstruction = "";
  if (libraryEntryId) {
    const entry = await getEntry(libraryEntryId);
    if (entry) scenarioInstruction = entry.scenario_instruction;
  }

  const productDoc = await getProductDoc(product);
  const system = await buildSystemPrompt({
    product,
    scenarioInstruction,
    dropdowns: { goal, audience, tone, mode },
    concise,
    includeLibraryTask: !libraryEntryId
  });
  const user = buildUserPrompt({ draft, promptExtra, searchResults, productDoc, customerContext });

  const { text, error, provider: usedProvider } = await callLLM({ provider, system, user });
  if (error) return { error };

  const parsed = parseStructuredOutput(text);

  let libraryId = libraryEntryId;
  let librarySkipped = null; // { reason, hits } when auto-add was blocked.
  if (libraryEntryId) {
    await bumpScore(libraryEntryId, "initial_uses", 1);
  } else if (parsed.cleanPrompt && parsed.scenarioSummary) {
    const piiHits = detectPII(parsed.cleanPrompt, parsed.scenarioSummary);
    if (piiHits.length) {
      // Refuse to land PII in the library. The two rewrites still surface to
      // the user; only the auto-grow path is blocked.
      librarySkipped = { reason: "pii_detected", hits: piiHits };
    } else {
      const dropdowns = { goal, audience, tone, mode, concise: !!concise };
      const existing = await findEquivalent({
        product,
        dropdowns,
        scenarioInstruction: parsed.cleanPrompt
      });
      if (existing) {
        await bumpScore(existing.id, "initial_uses", 1);
        libraryId = existing.id;
      } else {
        libraryId = crypto.randomUUID();
        await addEntry({
          id: libraryId,
          created_at: new Date().toISOString(),
          last_used_at: new Date().toISOString(),
          source: "generated",
          product,
          dropdowns,
          scenario_title: parsed.scenarioSummary.split(/[.\n]/)[0].slice(0, 80),
          scenario_summary: parsed.scenarioSummary,
          scenario_instruction: parsed.cleanPrompt,
          score: { initial_uses: 1, sent_as_is: 0, manager_approved: 0, rewrites_absorbed: 0 },
          pending_suggestions: []
        });
      }
    }
  }

  const record = {
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    conversation_id: conversationId,
    ticket_url: ticketUrl,
    product, goal, mode, audience, tone,
    concise: !!concise,
    library_entry_id: libraryId,
    prompt_instruction: scenarioInstruction || "",
    prompt_extra: promptExtra || "",
    rewrite_of: rewriteOf,
    provider: usedProvider,
    draft_input: draft || "",
    output_raw: text,
    output_parsed: parsed,
    chosen_version: null,
    delivery_action: null,
    delivered_at: null,
    outcome: null,
    final_sent: null,
    final_used_verbatim: null,
    final_used_text: null,
    final_used_boundary: null,
    final_used_at: null,
    final_used_stage: null,
    manager_rewrite_text: null,
    suggestion_log: suggestionLog,
    customer_context_used: customerContext ? true : false
  };
  await logDraft(record);

  return {
    parsed,
    raw: text,
    draftId: record.id,
    provider: usedProvider,
    libraryEntryId: libraryId,
    librarySkipped
  };
}
