// Library service: CRUD, scoring, equivalence match, seeding.

import { addTaxonomyValue } from "./storage.js";

const LIBRARY_KEY = "library_v3";
const SEEDED_KEY = "library_v3_seeded";

export const SCORE_WEIGHTS = {
  manager_approved: 5,
  sent_as_is: 2,
  rewrites_absorbed: 1,
  initial_uses: 0.25
};

export function weightedScore(score) {
  if (!score) return 0;
  return (
    (score.manager_approved || 0) * SCORE_WEIGHTS.manager_approved +
    (score.sent_as_is || 0) * SCORE_WEIGHTS.sent_as_is +
    (score.rewrites_absorbed || 0) * SCORE_WEIGHTS.rewrites_absorbed +
    (score.initial_uses || 0) * SCORE_WEIGHTS.initial_uses
  );
}

export async function getAllEntries() {
  const { [LIBRARY_KEY]: lib = [] } = await chrome.storage.local.get(LIBRARY_KEY);
  return lib.map((e) => ({ ...e, weighted_score: weightedScore(e.score) }));
}

export async function getEntry(id) {
  const all = await getAllEntries();
  return all.find((e) => e.id === id) || null;
}

async function saveAll(entries) {
  await chrome.storage.local.set({ [LIBRARY_KEY]: entries });
}

// Wholesale replace the library (used by Options → Import).
// Marks the store as seeded so seedIfEmpty does not re-fire on next load.
export async function replaceAllEntries(entries) {
  await saveAll(entries);
  await chrome.storage.local.set({ [SEEDED_KEY]: true });
}

// Wipe the library and the seeded flag (used by Options → Reset).
// Caller is expected to follow with seedIfEmpty() if they want seeds back.
export async function clearAll() {
  await chrome.storage.local.remove([LIBRARY_KEY, SEEDED_KEY]);
}

export async function addEntry(entry) {
  const { [LIBRARY_KEY]: lib = [] } = await chrome.storage.local.get(LIBRARY_KEY);
  lib.push(entry);
  await saveAll(lib);
}

export async function updateEntry(id, patch) {
  const { [LIBRARY_KEY]: lib = [] } = await chrome.storage.local.get(LIBRARY_KEY);
  const idx = lib.findIndex((e) => e.id === id);
  if (idx === -1) return false;
  lib[idx] = { ...lib[idx], ...patch };
  await saveAll(lib);
  return true;
}

export async function bumpScore(id, field, amount = 1) {
  const { [LIBRARY_KEY]: lib = [] } = await chrome.storage.local.get(LIBRARY_KEY);
  const idx = lib.findIndex((e) => e.id === id);
  if (idx === -1) return false;
  const score = lib[idx].score || {};
  score[field] = (score[field] || 0) + amount;
  lib[idx].score = score;
  lib[idx].last_used_at = new Date().toISOString();
  await saveAll(lib);
  return true;
}

export async function addSuggestion(entryId, suggestion) {
  const { [LIBRARY_KEY]: lib = [] } = await chrome.storage.local.get(LIBRARY_KEY);
  const idx = lib.findIndex((e) => e.id === entryId);
  if (idx === -1) return false;
  const queue = lib[idx].pending_suggestions || [];
  queue.push(suggestion);
  lib[idx].pending_suggestions = queue;
  await saveAll(lib);
  return true;
}

export async function resolveSuggestion(entryId, suggestionId, resolution) {
  const { [LIBRARY_KEY]: lib = [] } = await chrome.storage.local.get(LIBRARY_KEY);
  const idx = lib.findIndex((e) => e.id === entryId);
  if (idx === -1) return false;
  const queue = lib[idx].pending_suggestions || [];
  const sIdx = queue.findIndex((s) => s.id === suggestionId);
  if (sIdx === -1) return false;
  queue[sIdx].status = resolution;
  queue[sIdx].resolved_at = new Date().toISOString();
  lib[idx].pending_suggestions = queue;
  await saveAll(lib);
  return true;
}

// Apply a previously-accepted suggestion. Per the C2 design, the human has
// already seen a preview and confirmed; this function makes the mutations real.
//
// A suggestion can carry multiple proposed_changes. We apply all of them:
//   - refine_instruction    → overwrites scenario_instruction. If multiple,
//                             the last one wins (acknowledged, not silent).
//                             score.rewrites_absorbed increments once per
//                             refine that lands.
//   - new_tone/audience/goal → routed to addTaxonomyValue, all applied.
//   - split_entry           → never mutates the entry; flips the suggestion
//                             status to needs_manual so the UI can surface a
//                             manual create-new-entry handoff. If the same
//                             suggestion has *other* changes, those still
//                             land and the suggestion ends needs_manual so
//                             the human still sees the split flag.
//
// Returns:
//   { applied: <n>, status: "applied"|"needs_manual", changes: [{type, value}],
//     skipped: [...] }
export async function applySuggestion(entryId, suggestionId) {
  const { [LIBRARY_KEY]: lib = [] } = await chrome.storage.local.get(LIBRARY_KEY);
  const idx = lib.findIndex((e) => e.id === entryId);
  if (idx === -1) return { applied: 0, error: "entry not found" };
  const entry = lib[idx];
  const queue = entry.pending_suggestions || [];
  const sIdx = queue.findIndex((s) => s.id === suggestionId);
  if (sIdx === -1) return { applied: 0, error: "suggestion not found" };
  const suggestion = queue[sIdx];
  const proposed = suggestion.ai_analysis?.proposed_changes || [];
  if (!proposed.length) return { applied: 0, error: "no proposed change" };

  const now = new Date().toISOString();
  const applied = [];
  const skipped = [];
  let needsManual = false;

  // Apply each change. Order is preserved; later refine_instruction overwrites
  // earlier (last wins) but each still counts as an absorbed rewrite.
  for (const change of proposed) {
    if (change.type === "refine_instruction") {
      entry.scenario_instruction = change.value;
      entry.score = entry.score || {};
      entry.score.rewrites_absorbed = (entry.score.rewrites_absorbed || 0) + 1;
      entry.last_used_at = now;
      applied.push(change);
      continue;
    }
    if (change.type === "new_tone" || change.type === "new_audience" || change.type === "new_goal") {
      const fieldMap = { new_tone: "tones", new_audience: "audiences", new_goal: "goals" };
      await addTaxonomyValue(fieldMap[change.type], change.value);
      applied.push(change);
      continue;
    }
    if (change.type === "split_entry") {
      needsManual = true;
      skipped.push(change);
      continue;
    }
    skipped.push({ ...change, _reason: "unknown type" });
  }

  // Suggestion status: needs_manual wins (so the split flag remains visible)
  // unless nothing landed at all and split was the only thing — same outcome.
  // Otherwise "applied" if at least one change landed.
  if (needsManual) {
    queue[sIdx].status = "needs_manual";
  } else if (applied.length > 0) {
    queue[sIdx].status = "applied";
  } else {
    // Nothing landed and nothing flagged manual — pure failure.
    return { applied: 0, error: "no applicable changes", skipped };
  }
  queue[sIdx].resolved_at = now;
  await saveAll(lib);

  return {
    applied: applied.length,
    status: queue[sIdx].status,
    changes: applied,
    skipped
  };
}

// Suggestions awaiting a human decision: "pending" (not yet reviewed) or
// "needs_manual" (Accept on a split_entry — needs a manual create handoff).
export async function getAllPendingSuggestions() {
  const entries = await getAllEntries();
  const out = [];
  for (const e of entries) {
    for (const s of e.pending_suggestions || []) {
      if (s.status === "pending" || s.status === "needs_manual") {
        out.push({ entry: e, suggestion: s });
      }
    }
  }
  return out;
}

// ---------- equivalence match ----------
// Two entries are "equivalent" when product + goal + audience + tone + mode match.
// Summary similarity is not checked here — keep it simple, let the user merge via review.
export async function findEquivalent({ product, dropdowns }) {
  const all = await getAllEntries();
  return (
    all.find(
      (e) =>
        e.product === product &&
        e.dropdowns.goal === dropdowns.goal &&
        e.dropdowns.audience === dropdowns.audience &&
        e.dropdowns.tone === dropdowns.tone &&
        e.dropdowns.mode === dropdowns.mode
    ) || null
  );
}

// ---------- seeding ----------
export async function seedIfEmpty() {
  const { [SEEDED_KEY]: seeded } = await chrome.storage.local.get(SEEDED_KEY);
  if (seeded) return { seeded: false };
  const existing = await getAllEntries();
  if (existing.length > 0) {
    await chrome.storage.local.set({ [SEEDED_KEY]: true });
    return { seeded: false };
  }

  const url = chrome.runtime.getURL("prompts/om-seeds.json");
  const res = await fetch(url);
  if (!res.ok) return { seeded: false, error: "seed file missing" };
  const file = await res.json();

  const now = new Date().toISOString();
  const entries = (file.entries || []).map((e) => ({
    id: crypto.randomUUID(),
    created_at: now,
    last_used_at: null,
    source: "seed",
    product: e.dropdowns.product,
    dropdowns: {
      goal: e.dropdowns.goal,
      audience: e.dropdowns.audience,
      tone: e.dropdowns.tone,
      mode: e.dropdowns.mode,
      concise: !!e.dropdowns.concise
    },
    scenario_title: e.scenario_title,
    scenario_summary: e.scenario_summary,
    scenario_instruction: e.scenario_instruction,
    score: { initial_uses: 0, sent_as_is: 0, manager_approved: 0, rewrites_absorbed: 0 },
    pending_suggestions: []
  }));

  await saveAll(entries);
  await chrome.storage.local.set({ [SEEDED_KEY]: true });
  return { seeded: true, count: entries.length };
}
