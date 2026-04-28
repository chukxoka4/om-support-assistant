# Bug Resolution Plan

Logical order: data foundation → outcome model → loops → reliability → polish. Every fix slots into one architecture layer.

Each bug has:
- **Why** — the problem in one line
- **Files** — exact paths
- **What to do** — the change in plain language
- **Test** — what proves it's fixed (full spec in [05-TESTS.md](05-TESTS.md))

---

## Phase A — Data foundation

Stop the v2/v3 split. No behaviour change visible to user.

### A1 — Retire the dead v2 library store

**Why**: Every Options-page bug stems from the v2/v3 split. Killing v2 collapses 4 bugs into 0.

**Files**:
- [lib/prompts.js](../lib/prompts.js) — remove `getLibrary()` and `cachedDefaultLibrary`. Remove import of `getLibraryOverride`.
- [lib/storage.js](../lib/storage.js) — delete `getLibraryOverride`, `setLibraryOverride`, the `library: "library_override"` key from `KEYS`.
- [prompts/library.json](../prompts/library.json) — delete the file.
- [manifest.json](../manifest.json) — remove `prompts/library.json` from `web_accessible_resources`.
- [README.md](../README.md) — drop the line claiming `prompts/library.json` is the shareable artifact.

**What to do**: Pure deletion. Nothing in the runtime path used these.

**Test**: After deletion, full extension still loads. `getLibrary` is no longer importable. `library_override` key in storage is no longer read or written by any code path.

---

### A2 — Make Options Export / Import / Reset speak v3

**Why**: With v2 gone, the three Options buttons need a real target.

**Files**:
- [options.js](../options.js) — rewrite three handlers:
  - **Export**: import `getAllEntries` from [lib/library.js](../lib/library.js) and `getAllDrafts` from [lib/storage.js](../lib/storage.js). Output payload: `{ exported_at, version: 3, library, drafts }` — same shape as the side-panel export.
  - **Import**: accept `{ version: 3, library: [...] }` (drafts optional). Validate each entry has `id`, `product`, `dropdowns`, `scenario_instruction`. Call `replaceAllEntries(entries)`.
  - **Reset**: call `clearAll()` then trigger `seedIfEmpty()` so the seed list comes back fresh.
- [lib/library.js](../lib/library.js) — add two helpers:
  - `replaceAllEntries(entries)` — `saveAll(entries)` plus mark `library_v3_seeded = true`.
  - `clearAll()` — wipe `library_v3` and `library_v3_seeded` flag.
- [options.html](../options.html) — relabel buttons to clearer names: "Export library", "Import library", "Reset to seeds".

**What to do**: Repoint, validate, expose helpers in the right layer.

**Test**: Round-trip — export, clear storage, import, library matches. Reset produces 18 seeds. Import of malformed JSON shows a clear error.

---

### A3 — Make import errors visible

**Why**: Today, errors land in a small status text element. Easy to miss.

**Files**:
- [options.html](../options.html) — replace status `<div>` with a toast container at the top of the page.
- [options.js](../options.js) — toast helper: green for success, red for error, auto-dismiss after 4 seconds, click to dismiss sooner.

**What to do**: One small UI change. Reuse the toast for export and reset success too.

**Test**: Importing a junk file produces a red toast with the validation reason. Importing a valid file produces a green toast with entry count.

---

## Phase B — Outcome model cleanup

Kill dead branches so the mental model matches the code.

### B1 — Remove `edited` / `rewrote` outcomes and `correction_logged`

**Why**: They're referenced everywhere but never assigned. Removing them simplifies what readers and authors can trust.

**Files**:
- [lib/compose.js](../lib/compose.js) — drop `correction_logged` from the new draft record at [lib/compose.js:106](../lib/compose.js).
- [lib/storage.js](../lib/storage.js):
  - Remove `if (d.outcome === "rewrote" && d.correction_logged) return false;`
  - Remove `if (d.outcome === "edited" && d.correction_logged) return false;`
  - `TERMINAL_OUTCOMES` stays as `{sent, manager_approved, managerial_rewrite}`.
- [lib/metrics.js](../lib/metrics.js):
  - Drop the `edited` and `rewrote` counters from the return object.
- [sidepanel.js](../sidepanel.js):
  - In `renderRecentDrafts`, remove fallback rendering for those outcomes.
  - In the metrics grid render, drop those two tiles if any.

**What to do**: Audit, delete, simplify.

**Test**: `computeMetrics` return shape no longer includes `edited` or `rewrote`. No code path references `correction_logged`. `draftIsRevisitPending` returns false for any draft with terminal outcome only via the three real outcomes.

---

## Phase C — Wire the dead learning loop

### C1 — Call `proposeSuggestion` on managerial rewrite

**Why**: One line away from activating the marquee Adaptive feature.

**Files**:
- [sidepanel.js](../sidepanel.js) — in `saveManagerialRewrite` (~line 717), after the existing `bumpScore` call:
  ```
  if (draft.library_entry_id) {
    proposeSuggestion({
      entryId: draft.library_entry_id,
      draftId: draft.id,
      userOutput: chosenAssistantReply(draft),
      finalOutput: text,
      trigger: "managerial_rewrite"
    }).catch((e) => console.warn("proposeSuggestion failed:", e));
  }
  ```
  - Import `proposeSuggestion` from [lib/suggestions.js](../lib/suggestions.js).
  - Fire-and-forget. Per the file's own comment, it should not block UI.
- [lib/suggestions.js](../lib/suggestions.js) — no change.

**What to do**: One call site. Wrap in `.catch` so a failed proposal never breaks Step 2.

**Test**: After a managerial rewrite is saved, a pending suggestion appears in `pending_suggestions` for the linked entry. UI metric `pendingSuggestionCount` increments by 1.

---

### C2 — Suggestion accept / reject / defer (no auto-apply)

**Why**: Today, accepting a suggestion only changes `status`. The library entry's instruction never changes.

**Decision**: **No auto-apply for any suggestion type.** Every accept opens an "Apply this change?" confirm with a preview of the proposed instruction edit. Only after the human confirms does the entry mutate.

**Files**:
- [sidepanel.js](../sidepanel.js):
  - On Accept click, fetch the entry, render a small inline diff preview, expose two buttons: "Apply" / "Cancel".
  - On Apply, call `applySuggestion(entryId, suggestionId)` — new helper.
  - On Cancel, leave status as `pending`.
- [lib/library.js](../lib/library.js):
  - Add `applySuggestion(entryId, suggestionId)`:
    - For `refine_instruction`: replace `scenario_instruction`, mark suggestion `status: "applied"`, increment a new `score.rewrites_absorbed` field.
    - For `new_tone`/`new_audience`/`new_goal`: call `addTaxonomyValue` from [lib/storage.js](../lib/storage.js), mark applied.
    - For `split_entry`: do not auto-create a new entry. Instead, mark `status: "needs_manual"` and surface in the UI with a "Create new entry" button that pre-fills the form.

**What to do**: Wire accept → preview → apply. Keep risky operations human-gated.

**Test**: Accept on `refine_instruction` shows preview, applies on confirm, entry's `scenario_instruction` updates. Accept on `split_entry` does not mutate any entry; surfaces a manual-create handoff.

---

## Phase D — Reliability fixes for the compose pipeline

### D1 — Fallback when `parseStructuredOutput` fails

**Why**: The five-regex contract is brittle. Models can drift on labels.

**Files**:
- [lib/compose.js](../lib/compose.js):
  - In `parseStructuredOutput`, add a `wasParsed` boolean: true if any of `versionA` / `versionB` / `reason` is non-empty.
  - If `wasParsed` is false, return the raw text as `versionA` and a reason "Model output didn't match expected format. Showing raw response."
- [sidepanel.js](../sidepanel.js):
  - In `renderOutput`, if `parsed.wasParsed === false`, show a yellow banner above the output: "Couldn't parse — try again or switch provider."

**What to do**: Graceful degrade rather than empty boxes.

**Test**: Given a model output with no labels, parse returns `{wasParsed: false, versionA: <raw>, ...}`. UI renders the banner.

---

### D2 — Validate `CLEAN_PROMPT` for PII before saving to library

**Why**: Anonymisation is requested in the system prompt but never verified.

**Files**:
- [lib/compose.js](../lib/compose.js):
  - Before the auto-add at [lib/compose.js:62](../lib/compose.js), run a small PII regex pass on `cleanPrompt` and `scenarioSummary`:
    - Email: `/\S+@\S+\.\S+/`
    - Ticket ref: `/#\d{4,}/`
    - URL: `/https?:\/\//`
    - Customer name proper-noun guess: skip — too noisy.
  - If any match, skip the auto-add. Surface a yellow note in the rendered output: "Library entry not auto-saved — possible PII detected."

**What to do**: Cheap regex validation. No false-confidence about what we caught.

**Test**: Clean prompt with `support@acme.com` → not added. Clean prompt with `ticket #48291` → not added. Clean prompt with no patterns → added.

---

### D3 — Tighten `findEquivalent`

**Why**: Today, two scenarios with same dropdowns silently collide; the second's instruction is lost.

**Files**:
- [lib/library.js:103](../lib/library.js):
  - Add a 5th match dimension: first 60 chars of `scenario_instruction` (lowercased, trimmed, whitespace-normalised). Only equivalent if all 6 fields match.

**What to do**: One extra equality check. No schema change.

**Test**: Two seed-style entries with identical dropdowns but different instructions both survive.

---

### D4 — `chrome.sidePanel.open` user-gesture violation

**Why**: Console shows `sidePanel.open() may only be called in response to a user gesture`. The `await chrome.storage.local.set(...)` in `handleSendToAssistant` runs before `chrome.sidePanel.open()` and breaks the gesture chain, so Chrome rejects the open call. Currently swallowed by try/catch — selection still lands, the panel just doesn't auto-open.

**Files**: [background.js](../background.js) — `handleSendToAssistant` (~line 75–91).

**What to do**: Reorder. Call `chrome.sidePanel.open({ windowId })` synchronously inside the gesture window (before any `await`), then run the storage write. The side panel picks up `incoming_selection` via the storage change event a moment later.

**Test**: With side panel closed, right-click selected text → "Send to Assistant" → panel opens. Console shows no `sidePanel.open failed` warning.

---

## Phase E — Polish

### E1 — Safe `scenario_title` truncation

**Files**: [lib/compose.js:77](../lib/compose.js).

**What to do**: Replace the brittle `split(/[.\n]/)[0].slice(0, 80)` with a helper:
```
function safeTitle(summary) {
  const trimmed = (summary || "").trim();
  if (!trimmed) return "Untitled scenario";
  const firstSentence = trimmed.split(/[.\n]/)[0].trim();
  if (firstSentence.length >= 5 && firstSentence.length <= 80) return firstSentence;
  const words = trimmed.split(/\s+/).slice(0, 8).join(" ");
  return words.length > 80 ? words.slice(0, 77) + "…" : words;
}
```

**Test**: Empty summary → `"Untitled scenario"`. Long unbroken summary → first 8 words.

---

### E2 — Consistent `max_tokens` across providers

**Files**: [providers/index.js](../providers/index.js), [providers/claude.js](../providers/claude.js), [providers/openai.js](../providers/openai.js), [providers/gemini.js](../providers/gemini.js).

**What to do**: Add `MAX_OUTPUT_TOKENS = 4096` to [providers/index.js](../providers/index.js). Pass through to each provider call. Claude already uses `max_tokens`; OpenAI uses `max_tokens` (Chat Completions); Gemini uses `generationConfig.maxOutputTokens`.

**Test**: All three providers honour the same cap. Default 4096.

---

### E3 — Expire dismissals after 7 days

**Files**: [lib/storage.js](../lib/storage.js).

**What to do**: In `getDismissal`, return null if `Date.now() - timestamp > 7 * 24 * 60 * 60 * 1000`. Periodically prune in a small background helper.

**Test**: Dismissal older than 7 days returns null.

---

### E4 — Delete duplicate `logQuickTransform`

**Files**: [lib/storage.js:118](../lib/storage.js), [background.js](../background.js).

**What to do**: Remove `logQuickTransform`. Update [background.js](../background.js) to call `logDraft` directly with the same payload.

**Test**: Quick transforms still appear in `draft_log` with `action_type` set.

---

## Order of execution (single dependency chain)

```
A1 → A2 → A3
     ↓
B1
     ↓
C1 → C2
     ↓
D1, D2, D3 (parallel safe)
     ↓
E1, E2, E3, E4 (parallel safe)
```

A and B are pure cleanup. C activates the dormant feature. D and E harden the pipeline. Then features in [03-FEATURES.md](03-FEATURES.md).
