// Library ranker — returns the top 5 entries that best match a rough draft
// + the current dropdown selection. Two modes:
//
//   rankLexical(draft, dropdowns, entries)
//     pure JS, instant. Tunable scoring with a quality floor so a strip
//     only renders when the match is real.
//
//   rankLLM(draft, dropdowns, entries, callLLM)
//     one provider call; returns the same shape. The user toggles between
//     the two so we can compare in real use.
//
// Both return [{ entry, score, reason }] of length ≤ 5.

const TOP_N = 5;

// Scoring weights for the lexical mode. Theoretical max is 34: dropdowns 16 +
// lexical 10 + weighted 6 + recency 2 = 34. Quality floor below.
const W = {
  DROPDOWN_PER_FIELD: 4,    // 4 dropdowns × 4 pts = 16 max
  LEXICAL_MAX: 10,
  WEIGHTED_MAX: 6,
  RECENCY_BONUS: 2,
  CONCISE_PENALTY: 2,
  RECENCY_DAYS: 14,
  QUALITY_FLOOR: 8           // top score must clear this to surface
};

const STOPWORDS = new Set([
  "the","a","an","is","are","was","were","be","been","being","of","to","in",
  "on","for","with","at","by","this","that","it","i","my","we","our","you",
  "your","they","their","and","or","but","if","then","so","not","no","do",
  "does","did","have","has","had","can","could","would","should","will","just"
]);

function tokenise(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((t) => t && t.length > 2 && !STOPWORDS.has(t));
}

// Jaccard-style overlap, capped at LEXICAL_MAX. Counts unique-token hits in
// the entry's title+summary against the draft's tokens. Linear in tokens.
function lexicalScore(draftTokens, entry) {
  if (!draftTokens.length) return 0;
  const haystack = tokenise(`${entry.scenario_title || ""} ${entry.scenario_summary || ""}`);
  if (!haystack.length) return 0;
  const draftSet = new Set(draftTokens);
  const haySet = new Set(haystack);
  let hits = 0;
  for (const t of haySet) if (draftSet.has(t)) hits += 1;
  // Map raw hits onto the 0..LEXICAL_MAX scale. Saturate at 5 hits.
  return Math.min(W.LEXICAL_MAX, Math.round((hits / 5) * W.LEXICAL_MAX));
}

function dropdownScore(dropdowns, entry) {
  const d = dropdowns || {};
  const ed = entry.dropdowns || {};
  let s = 0;
  if (d.goal && d.goal === ed.goal) s += W.DROPDOWN_PER_FIELD;
  if (d.audience && d.audience === ed.audience) s += W.DROPDOWN_PER_FIELD;
  if (d.tone && d.tone === ed.tone) s += W.DROPDOWN_PER_FIELD;
  if (d.mode && d.mode === ed.mode) s += W.DROPDOWN_PER_FIELD;
  return s;
}

// Map the entry's accumulated weighted_score onto a 0..WEIGHTED_MAX bonus.
// Library entries with manager_approved hits dominate; we don't want them to
// blow out the ranker, just nudge.
function weightedBonus(entry) {
  const ws = entry.weighted_score || 0;
  // Soft cap: 30 weighted score → full WEIGHTED_MAX. Tunable.
  return Math.min(W.WEIGHTED_MAX, Math.round((ws / 30) * W.WEIGHTED_MAX));
}

function recencyBonus(entry) {
  if (!entry.last_used_at) return 0;
  const days = (Date.now() - new Date(entry.last_used_at).getTime()) / (24 * 60 * 60 * 1000);
  return days <= W.RECENCY_DAYS ? W.RECENCY_BONUS : 0;
}

function concisePenalty(dropdowns, entry) {
  const requested = !!dropdowns?.concise;
  const has = !!entry.dropdowns?.concise;
  return requested !== has ? W.CONCISE_PENALTY : 0;
}

export function rankLexical(draft, dropdowns, entries) {
  if (!Array.isArray(entries) || !entries.length) return [];
  const product = dropdowns?.product;
  const candidates = entries.filter((e) => !product || e.product === product);
  if (!candidates.length) return [];

  const draftTokens = tokenise(draft || "");
  const scored = candidates.map((entry) => {
    const lex = lexicalScore(draftTokens, entry);
    const dd = dropdownScore(dropdowns, entry);
    const wt = weightedBonus(entry);
    const rec = recencyBonus(entry);
    const pen = concisePenalty(dropdowns, entry);
    const score = dd + lex + wt + rec - pen;

    // Reason: short string explaining the dominant signal. Useful for UI hint.
    const parts = [];
    if (dd) parts.push(`dropdowns +${dd}`);
    if (lex) parts.push(`lexical +${lex}`);
    if (wt) parts.push(`weight +${wt}`);
    if (rec) parts.push("recent");
    if (pen) parts.push(`concise mismatch -${pen}`);
    const reason = parts.join(" · ") || "weak match";

    return { entry, score, reason };
  });

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, TOP_N);
  if (!top.length || top[0].score < W.QUALITY_FLOOR) return [];
  return top;
}

const LLM_SYSTEM = `You are ranking library entries by relevance to a support draft.
Read the draft and the requested dropdowns, then pick at most 5 entries from the candidates.
Return ONLY JSON in this exact shape, no prose:

[{ "id": "<entry-id>", "score": <0-100>, "reason": "<one short clause>" }, ...]

Order by score, highest first. Omit entries that don't fit. score is your subjective fit.`;

function buildLLMUser(draft, dropdowns, candidates) {
  const dd = JSON.stringify(dropdowns || {});
  const lines = candidates.map((e) =>
    `- id: ${e.id}\n  product: ${e.product}\n  dropdowns: ${JSON.stringify(e.dropdowns || {})}\n  title: ${e.scenario_title}\n  summary: ${e.scenario_summary}`
  ).join("\n");
  return `Draft:\n${draft || "(empty)"}\n\nRequested dropdowns:\n${dd}\n\nCandidates:\n${lines}`;
}

export async function rankLLM(draft, dropdowns, entries, callLLM) {
  if (!Array.isArray(entries) || !entries.length) return [];
  const product = dropdowns?.product;
  const candidates = entries.filter((e) => !product || e.product === product);
  if (!candidates.length) return [];

  // Cap candidate count we send. The whole library could be >100 entries.
  // Send the 30 strongest by weighted_score so the LLM gets a shortlist.
  const shortlist = [...candidates]
    .sort((a, b) => (b.weighted_score || 0) - (a.weighted_score || 0))
    .slice(0, 30);

  const { text, error } = await callLLM({
    system: LLM_SYSTEM,
    user: buildLLMUser(draft, dropdowns, shortlist)
  });
  if (error) throw new Error(`LLM ranker failed: ${error}`);

  let parsed;
  try {
    const match = text.match(/\[[\s\S]*\]/);
    parsed = JSON.parse(match ? match[0] : text);
  } catch (e) {
    throw new Error("LLM ranker returned unparseable JSON");
  }
  if (!Array.isArray(parsed)) throw new Error("LLM ranker did not return an array");

  const byId = new Map(candidates.map((e) => [e.id, e]));
  const out = [];
  for (const row of parsed) {
    const entry = byId.get(row.id);
    if (!entry) continue;
    out.push({
      entry,
      score: typeof row.score === "number" ? row.score : 0,
      reason: row.reason || "llm pick"
    });
    if (out.length >= TOP_N) break;
  }
  return out;
}
