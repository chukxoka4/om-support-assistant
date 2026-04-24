// Library service: CRUD, scoring, equivalence match, seeding.

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

export async function getAllPendingSuggestions() {
  const entries = await getAllEntries();
  const out = [];
  for (const e of entries) {
    for (const s of e.pending_suggestions || []) {
      if (s.status === "pending") out.push({ entry: e, suggestion: s });
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
