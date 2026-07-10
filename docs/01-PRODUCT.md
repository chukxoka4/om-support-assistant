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

## On-going (originally "built but unwired" — most now wired)

This section was the project's original gap analysis. **Most items have shipped** ([02-BUGS.md](02-BUGS.md), [03-FEATURES.md](03-FEATURES.md)). Kept here as a historical record of where we started and to surface what's still open.

### The library learning loop — ✅ wired (Bug C1, C2)
- `proposeSuggestion` in [lib/suggestions.js](../lib/suggestions.js) is now called fire-and-forget on every managerial rewrite.
- UI at the side panel's Review queue tab renders pending suggestions; Accept opens an inline preview; Apply mutates with `rewrites_absorbed` increment. No auto-apply ([DECISIONS.md D2](DECISIONS.md#d2)).
- The library learns *both* scores and *content* via `applySuggestion`.

### The library is grown and retrieved — ✅ wired (Feature F1)
- Below the draft textarea, a top-5 ranked suggestion strip surfaces relevant library entries before the agent hits Generate.
- Lex / LLM toggle in the strip header ([DECISIONS.md D6](DECISIONS.md#d6)).
- Picker dropdown still works for explicit selection.

### Options-page Export / Import / Reset — ✅ wired against v3 (Bug A2)
- All three buttons read/write `library_v3`. Side panel mirrors them.
- Import has an explicit Merge / Replace confirmation step; no destructive default.
- v2 store entirely retired ([DECISIONS.md D18](DECISIONS.md#d18)).

### Metrics show categories that can never populate — ✅ removed (Bug B1)
- `edited` / `rewrote` outcomes deleted; `correction_logged` removed.
- Three terminal outcomes only: `sent` / `manager_approved` / `managerial_rewrite`.

### Other scaffold without wiring
- `quick-transform` outcome remains null and never updatable. Quick transforms are operational, not part of the revisit loop. **Status: by design.**
- Suggestion review UI has accept / reject / defer / **apply preview** — no auto-apply. **Status: shipped, non-auto-apply per [DECISIONS.md D2](DECISIONS.md#d2).**

### Genuinely still on-going (as of 2026-04-30)
- **F3 outreach mode** — second tab in the side panel for proactive emails (renewal, win-back, post-resolution). Spec in [03-FEATURES.md](03-FEATURES.md).
- **F4 cross-ticket synthesis** — LLM pass over 30 days of `draft_log` for product / marketing intelligence. Deferred until F3 + real volume.
- **F6 rich-text editor** — full WYSIWYG for the three customer-facing textareas. Spec in [03-FEATURES.md](03-FEATURES.md).
- **Polish bugs E1–E4** — small clean-ups in [02-BUGS.md](02-BUGS.md).

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

## Where this sits on the AI Adoption Rubric

**Original tier (pre-A1 / pre-F1 / pre-F2): solid Capable, with one Adaptive-tier asset (the library).**

**Current tier (as of 2026-04-30, after A1–C2 + D1–D3 + F1 + F2 shipped):** Solid Capable across the board, Adaptive on three lines, foothold in Transformative.

```
                    Originally       Now (2026-04-30)
─────────────────────────────────────────────────────
C1 Compose & rewrite     ✓ Met         ✓ Met
C2 Knowledge retrieval   Partial       Met (F1 retrieval surfaces lib entries)
C3 Customer history      Missing       Met (F2 chip surfaces plan/tenure/engagement)
C4 Upsell awareness      Partial       Met (plan/status/MRR/trial in compose context)
C5 Transformations       ✓ Met         ✓ Met

A1 Measured baseline     Partial       Met (draft_log + readyRate / managerRate)
A2 Personalised tmpls    Missing       Met (compose pulls customer ctx)
A3 Voice of customer     Missing       Missing (needs F4 synthesis)
A4 Proactive outreach    Missing       Missing (needs F3)
A5 Tone/voice consistency  Partial     Partial (house-style works,
                                                no automated audit)
A6 Library that learns   Met-with-bug  ✓ Truly Met (C1 + C2 wired)

T1 Predictive routing    Missing       Missing
T2 Outcome optimisation  Missing       Missing
T3 Account-level intel   Missing       Foothold (F2 surfaces companies)
T4 Self-service loops    Missing       Missing
T5 Cross-team intel      Missing       Missing
```

The remaining gaps that are realistic to close in Q3:
- **A4** — F3 (outreach mode) closes this.
- **A3 + T5** — F4 (cross-ticket synthesis) closes both.
- **A1** — already Met but the May 1 weekly digest cadence ([06-REVIEW-PLAN.md](06-REVIEW-PLAN.md)) makes the "measured" part visible to the team. Trend data after 8 weeks compounds the case.

See [06-REVIEW-PLAN.md](06-REVIEW-PLAN.md) for the supervisor-facing write-up of this rubric story.
