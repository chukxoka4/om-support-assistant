# Product Understanding

## What this product is

A Chrome extension that **reviews your support drafts** and returns two rewrites plus a reason. You write a rough draft and context; the extension calls an AI provider (Gemini, Claude, or OpenAI); you copy or insert one of the rewrites into the OM ticket editor.

Three surfaces:
- **Side panel** — main workspace. Compose, see results, manage library.
- **Ticket page modal** — when you reopen a ticket with an unresolved draft, a native browser dialog reminds you to finish Step 1/Step 2.
- **Right-click overlay** — quick retones (fix grammar, friendlier, shorter, etc.) and translations to 22 languages on any selected text.

## Present (works today)

### Compose pipeline
- System prompt is built as: role → house style → output contract → dropdowns context → scenario instruction → optional library task. ([lib/voice.js](../lib/voice.js))
- AI returns: `REASON`, `VERSION A (The Polish)`, `VERSION B (The Revamp)`, plus `CLEAN_PROMPT` + `SCENARIO_SUMMARY` when no library entry was used. ([lib/compose.js](../lib/compose.js))
- Provider-agnostic dispatcher in [providers/index.js](../providers/index.js). Defaults: Gemini Flash, Claude Sonnet 4.6, GPT-4o.

### Library
- Single store: `library_v3` in `chrome.storage.local`.
- Seeded once on install from [prompts/om-seeds.json](../prompts/om-seeds.json) — 18 OM scenarios.
- Auto-grows: every compose without a preset reverse-engineers an anonymised instruction and saves it.
- Score weights: `manager_approved=5`, `sent_as_is=2`, `rewrites_absorbed=1`, `initial_uses=0.25`. Manager-touched outcomes dominate.
- Mutable taxonomy (goals/audiences/tones/modes) at runtime.

### Two-step revisit loop
- **Step 1** (after copy/insert): "What went forward?" — `as_copied` / `edited` / `manager_first`. Saves `final_used_*` fields. Does not set `outcome`.
- **Step 2** (after manager review): Sent / Manager approved (+5) / Managerial rewrite (+5). Sets `outcome`. Bumps library score.

### Quick transforms
- Right-click on selection → retone (7 actions) or translate (22 languages).
- Shows a dark/light-adaptive overlay with typewriter reveal, Replace / Copy / Cancel.
- Logged into `draft_log` with `action_type: "quick-retone"` or `"quick-translate"`.

### Metrics
- 30-day rolling window: `readyRate`, `managerRate`, draft volume, quick transforms, library count, pending suggestion count. ([lib/metrics.js](../lib/metrics.js))

## On-going (built but unwired — the seams)

These are scaffolded in code, not connected. They are the difference between "infrastructure for Adaptive" and "is Adaptive."

### The library learning loop is dead
- `proposeSuggestion` in [lib/suggestions.js](../lib/suggestions.js) is defined, exported, never called.
- The UI at [sidepanel.js:508](../sidepanel.js) renders pending suggestions, but the queue is permanently empty.
- The library learns *scores* but not *content*.

### The library is grown but not retrieved
- Picker dropdown is the only on-compose binding ([lib/compose.js:39](../lib/compose.js)).
- You don't use the dropdown.
- Library accumulates and goes unused at compose time.

### Options-page Export / Import / Reset point at a dead store
- Read/write `library_override` (v2), not `library_v3` (live).
- v2 file [prompts/library.json](../prompts/library.json) is fossilised.
- Import shape validation expects `{version, actions: []}` — a shape that exists nowhere.
- Side panel has a working export ([sidepanel.js:428](../sidepanel.js)); no working import.

### Metrics show categories that can never populate
- `outcome = "edited"` and `outcome = "rewrote"` referenced but never assigned anywhere.
- `correction_logged` initialised to `false`, never set true.
- Two zero-buckets in the dashboard. Misleading.

### Other scaffold without wiring
- `quick-transform` outcome is null and never updatable.
- Suggestion review UI has accept/reject/defer but no auto-apply on accept.

## Future (rubric-aligned roadmap)

Three threads, in priority order. Details in [03-FEATURES.md](03-FEATURES.md).

### F1 — In-textarea library suggestions
After you type a rough draft and pause, a strip of 5 ranked library entries appears under the textarea. Two ranker modes — **Lexical** (local, instant) and **LLM** (round trip, smarter) — with a switcher so you can compare them.

This makes the library *active* instead of archive. Closes the "library not retrieved" gap.

### F2 — Intercom customer context (own MCP, in this repo)
A small MCP server lives in `mcp-intercom/` in this repo (built fresh, not the one in `~/projects/cross-sell` — that's reference only).

The side panel pulls a customer health snapshot whenever a ticket is open — **not only when you're drafting**. So when you're just browsing tickets, you see the chip too.

The snapshot also feeds into compose as extra context when you do draft.

Closes Capable C2/C3/C4. Partially opens Adaptive A2/A3 and Transformative T3.

### F3 — Outreach mode
Second tab in the side panel. Pick a customer + a template (renewal-30d, win-back-60d, post-resolution-checkin, cross-product-cross-sell). Generates a proactive outreach email with the customer snapshot baked in.

Closes Adaptive A4. Begins Transformative T2.

### F4 — Cross-ticket synthesis (later)
"Synthesis" button in the library panel. LLM pass over the last 30 days of `draft_log`. Returns top 5 recurring issues, top 3 frustrated-customer patterns, top 3 upgrade-signal patterns. JSON export for product/marketing.

Closes Adaptive A2 fully. Closes Transformative T5.

Deliberately last — needs F1 and F2 in production first so the data shape is real.

## Where this sits on the AI Adoption Rubric today

**Tier: solid Capable, with one Adaptive-tier asset (the library).**

- Capable C1 — Met. C2 — Partial (no live KB search). C3 — Missing (no customer history). C4 — Partial (handles upsell when picked, doesn't suggest). C5 — Met (quick transforms + audience dropdown).
- Adaptive A1 — Partial (workflow systematised, no measured baseline). A2/A3/A4/A5 — Missing. A6 — Met but with the dead-loop bug suppressing it.
- Transformative — all Missing.

After the bug plan and F1+F2: Capable across the board, Adaptive on three lines, foothold in Transformative.
