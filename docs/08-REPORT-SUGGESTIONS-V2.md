# Report & Suggestions v2 — the May 8 batch

Everything built on **2026-05-08** (commits `38803be` → `06997f7`), after the
big docs sweep (`9e57edd`, 2026-04-30). None of this was captured in the
original docs — this file is the catch-up. It is the source of truth for the
outcome-driven learning loop, range-based reporting, the hypothesis lens, the
searchable dropdowns, and the two new best-effort/utility modules.

If you're touching drafts→library learning, the weekly report, the Audit tab
dropdowns, or `draft_log` timestamps, read this first, then the code.

> **Provenance.** The design conversation for this batch is session
> `c88ab193…` (2026-05-08) and the tail of session `26b01c45…`. The features
> below each trace to an explicit user request quoted in
> [DECISIONS.md D26–D33](DECISIONS.md). Read those for the *why*; this file is
> the *what* and *how*.

---

## TL;DR — what shipped

| # | Commit | What | New/changed files |
|---|---|---|---|
| 1 | `38803be` | Timestamp outcome transitions on drafts (`outcome_at`) | `lib/storage.js` |
| 2 | `c7ed104` | Range-based audit-metrics windows + split counts | `lib/audit-metrics.js` |
| 3 | `bea9d35` | Wire a date range through the report + live metrics | `lib/report-html.js`, `lib/report-slack.js`, `sidepanel.js` |
| 4 | `3e72bb8` | Outcome-driven suggestion proposals (corrected comparison) | `lib/suggestions.js`, **`lib/diff-text.js`** |
| 5 | `9f44900` | Searchable-select component | **`lib/searchable-select.js`**, **`lib/searchable-select.css`** |
| 6 | `c474317` | Apply searchable-select to taxonomy + library pickers | `sidepanel.js`, `sidepanel.html` |
| 7 | `217dc0b` | Live-refresh suggestion tile on library mutations | `sidepanel.js` |
| 8 | `a9b2c97` | Optional hypothesis investigation in the weekly report | `lib/prompt-generator.js`, `lib/wpsa-schema.js`, `lib/report-html.js`, `lib/charts.js`, `sidepanel.js` |
| 9 | `06997f7` | Best-effort LLM polish on the "ask" + hypothesis text | **`lib/text-polish.js`**, `sidepanel.js` |

Three brand-new layer-2/3 modules: **`lib/diff-text.js`**,
**`lib/searchable-select.js`**, **`lib/text-polish.js`**. Plus
`lib/searchable-select.css`. Add these to the architecture layer lists
(see [00-INDEX.md](00-INDEX.md) / [CONTEXT-MAP.md](CONTEXT-MAP.md)).

---

## 1. Outcome-driven suggestion proposals (the big one)

**The bug that started it.** The user noticed *"the suggestions were stuck on
8 for a long time and it did not make sense."* Two root causes: (a) the review
tile didn't live-refresh (see §7), and (b) more fundamentally, the learning
loop only fired on a *managerial rewrite* and compared the wrong two texts.

**The old model (pre-May-8).** `proposeSuggestion` was called inline from
`saveManagerialRewrite` in the UI, comparing the **AI output** to the
**manager's rewrite**. Problem: the agent almost always self-edits before
sending — *"I have very few instances where I have sent the email as is."* So
the AI-output-vs-manager delta attributed the agent's own edits to the model,
polluting the lesson.

**The new model.** Suggestion creation is pulled out of the UI handler
entirely and moved behind a single funnel in
[lib/suggestions.js](../lib/suggestions.js). It fires on **outcome
confirmation**, not on send, and branches on which outcome the draft
transitioned into:

| Outcome | `userOutput` (what to improve *from*) | `finalOutput` (the target) | trigger |
|---|---|---|---|
| `sent` / `manager_approved` | AI output (chosen version) | the agent's self-edit, else AI output verbatim | `self_edit` |
| `managerial_rewrite` | what actually went out (self-edit if any, else AI output) | the manager's rewrite text | `managerial_rewrite` |

So the loop now learns from the agent's *self-edits* on approved drafts (the
common case) and from the *manager's delta over what the agent sent* on
rewrites — never blaming the model for the human's own edits.

**The two functions** (split so the decision is testable without side effects):

- `decideProposal(draft)` — pure. Returns `{ args }` to fire, or
  `{ skip: <reason> }`. Skip reasons: `no_draft`, `no_library_entry`,
  `non_terminal_outcome`, `no_manager_text`, `no_diff`.
- `maybeProposeFromOutcome(draft)` — side-effecting wrapper. Calls
  `decideProposal`, then an **idempotency guard**: if the entry already has a
  `pending`/`needs_manual` suggestion for this `draft.id`, it returns
  `{ skip: "already_pending" }` instead of double-firing.

**The no-diff guard.** [lib/diff-text.js](../lib/diff-text.js) `isMeaningfulDiff(a, b)`
normalises both texts (strip HTML tags, decode a few entities, collapse
whitespace, lowercase) and compares. If they're equal, we skip the LLM call
entirely — nothing to learn. This is why "verbatim send with no edit"
short-circuits cleanly (self-edit falls back to AI output → identical → skip).
The user explicitly rejected a numeric threshold: *"you should just try to
check for differences."*

**Where it's wired.** `sidepanel.js` (~line 2198) calls
`maybeProposeFromOutcome(fresh)` when a draft's outcome/`outcome_at`/
`manager_rewrite_text` transition is confirmed. Fire-and-forget; failures are
`console.warn`ed, never surfaced.

**Draft fields this depends on:** `library_entry_id`, `outcome`,
`chosen_version` (`version-a`/`version-b`), `output_parsed.{versionA,versionB}`,
`output_raw`, `final_used_text`, `final_used_verbatim`, `manager_rewrite_text`.

See [DECISIONS.md D26](DECISIONS.md#d26).

---

## 2. `outcome_at` — timestamping outcome transitions

`updateDraft(id, patch)` in [lib/storage.js](../lib/storage.js) now stamps
`outcome_at = new Date().toISOString()` on the **first** transition into a
non-null `outcome` — but only if the caller didn't already supply one and the
draft doesn't already have one.

**Why it exists.** A draft is *generated* on one date and its outcome
(`manager_approved`, etc.) can land days later. The user's example: *"you
generate a draft on April 1 but mark manager_approved on April 6. A report for
April 5–7 would currently miss this draft entirely or attribute it to April 1
— wrong week."* `outcome_at` lets range-based reports bucket by *when the
outcome happened*, separate from `ts` (when it was generated).

Drafts created before this shipped have no `outcome_at` and simply don't appear
in outcome-bucket counts (they still count in generated-by-`ts`). No migration
/ back-fill was done — the user signed off: *"the migration concern can be
dealt with as mentioned… No need to reattribute if okay."*

See [DECISIONS.md D27](DECISIONS.md#d27).

---

## 3. Range-based audit metrics + split counts

[lib/audit-metrics.js](../lib/audit-metrics.js) now supports **two windowing
modes** side by side:

- **Legacy trailing window** (`windowDays` + `now`) — still used by the
  side-panel live metric tiles. Untouched.
- **Range-based** (`{ rangeStart, rangeEnd }` as ISO strings or epoch ms) —
  used by the report. Bucketing is **UTC-anchored** (derived from ISO date
  inputs so day boundaries are stable across timezones).

**The split-counts insight.** Rather than reattribute drafts to a single
"week," counts are split by *which timestamp* they're filtered on — the user's
call: *"Why not split the stats — Generated data should be separate from
approved."*

| Export | Filtered by | Meaning |
|---|---|---|
| `generatedInRange(drafts, s, e)` | `draft.ts`, compose-only | drafts *created* in the window |
| `sentInRange(drafts, s, e)` | `outcome_at`, outcome ∈ `sent`\|`manager_approved` | drafts *finished-good* in the window |
| `rewrittenInRange(drafts, s, e)` | `outcome_at`, outcome = `managerial_rewrite` | drafts the manager rewrote in the window |
| `suggestionResolutionsInRange(library, s, e)` | `suggestion.resolved_at` | applied/rejected/deferred in window (+ pending all-time) |
| `libraryStateInRange(library, s, e)` | `entry.created_at` | library size + `addedInRange` + generated count |
| `librarySizeSeriesInRange(library, s, e)` | `entry.created_at` | one point per day — the growth line chart |

Drafts without `outcome_at` are excluded from `sentInRange`/`rewrittenInRange`
(honest about what we can't date), still counted in `generatedInRange`.

New draft/suggestion/entry fields relied on: `outcome_at`, `resolved_at`,
`created_at`. See [DECISIONS.md D28](DECISIONS.md#d28).

---

## 4. Date range wired through the report

The Audit tab now lets the agent pick a **date range** that flows into both the
report and the live metrics. *"I need whatever I set as the timeframe to
actually pick from that and adjust immediately… I need clean data points that
are not overlapping."*

- The range feeds `buildWpsaPrompt({ weekStart, weekEnd, … })` so the WPSA AI
  prompt asks for the same window.
- The extension-internal metrics refresh to that range on change (via the
  split-count helpers in §3).
- The dropdown still defaults to the previous Mon→Sun ISO range
  (`previousWeekRange` in `lib/prompt-generator.js`), but the agent can widen it
  — *"we have quarterly reviews and it would be a nice to have."*

See [DECISIONS.md D29](DECISIONS.md#d29).

---

## 5. Searchable-select component

**Motivation.** *"These dropdowns need to be search-based, they are growing."*
But also: *"show something but not a long list that makes it look unpleasant…
some of the titles are too long and don't make sense to search for on the fly."*
Resolution: ~7–10 visible rows + a search box + "search for more."

[lib/searchable-select.js](../lib/searchable-select.js) — pure DOM module
(no `chrome.*`, no project imports). `attachSearchableSelect(selectEl, opts)`
**progressively enhances** a native `<select>`:

- Keeps the `<select>` as the source of truth — form serialization,
  programmatic `select.value = …`, and `change` events all keep working. The
  native element is visually hidden (1px, opacity 0) but stays in the DOM.
- Renders a trigger button + popup with a filter input and a `listbox`.
- `maxVisibleRows` (default 8) caps the visible list height.
- Keyboard: ↑/↓ to move, Enter to pick, Esc to close; outside-click closes.
- Optional `onAddNew(typedQuery)` callback — fires when the user clicks
  `Add "foo"` on a no-match query. Returns the value to insert or `null`. The
  component does **not** mutate the option list itself — the caller repopulates
  the `<select>` and the component re-renders.
- `refresh()` re-syncs the trigger label after a programmatic value set (those
  don't fire `change`).

**Where applied** (`sidepanel.js`): goal / audience / tone / mode taxonomy
dropdowns and the library picker (`libraryPickHandle`). CSS in
[lib/searchable-select.css](../lib/searchable-select.css) (`.ss-*` classes).

The user's constraint held the whole time: *"remember the code has to be
layered and follow structural alignment, do not throw it away."*

See [DECISIONS.md D30](DECISIONS.md#d30).

---

## 6. Hypothesis investigation in the weekly report

**The real-world motivation** (verbatim): *"we are having specific bug reports
around a new feature and it appears that we underestimate how many people
create a campaign and then only go forward by duplicating and editing it. So we
need insights from the duplication button."* The agent wanted to feed a hunch
into the weekly report and have the analyser test it against the tickets —
without letting the hunch distort the headline numbers.

**Design constraints the user set:**
- **Additive, not a change.** *"I want my hypothesis to be rendered separately
  in case it is nothing… additive not a change."*
- **Optional field.** When nothing is entered, *"should not appear in the
  report at all — header and the… collapsed section should only show when there
  was something."*
- **Per-finding mini-report.** *"It should be per-finding. Almost like its own
  report based on that guiding hypothesis."* — verdict + evidence + how it
  recasts the friction leaderboard / O/I.
- **Collapsible.** A section in the HTML report *"that shows how the hypothesis
  affects the friction areas, O/I etc."*, collapsed by default.

**How it's wired:**

1. **Prompt** — `buildWpsaPrompt({ …, hypotheses: [] })` in
   [lib/prompt-generator.js](../lib/prompt-generator.js) appends a
   `hypothesesBlock` and a `hypothesisFindings[]` schema stanza **only when
   hypotheses are present**. The prompt is explicit that hypotheses are an
   *additive lens* and must not override the headline numbers.
2. **Schema** — `validateWpsaShape` in
   [lib/wpsa-schema.js](../lib/wpsa-schema.js) normalises an optional
   `hypothesisFindings[]`. Each finding: `hypothesis` (echoed verbatim),
   `supported` ∈ `yes`\|`partially`\|`no`\|`insufficient_data` (unknown values
   drop to `null` rather than failing validation — *"a flaky analyser can't
   break the whole report"*), `evidence`, `supportingTicketIds[]` (0–3),
   `frictionReframe`\|null, `oiImpact`\|null, `recommendedAction`\|null.
3. **HTML render** — `hypothesisCard(finding)` in
   [lib/report-html.js](../lib/report-html.js) renders each finding; the
   `<details class="hyp-mini">` collapsible only appears when
   `frictionReframe`/`oiImpact`/`recommendedAction` are present. Findings from
   the personal + team scopes are **deduped by hypothesis text** (personal
   first; team adds only net-new).
4. **Slack snippet** — [lib/report-slack.js](../lib/report-slack.js) mentions
   the count only (`N hypotheses investigated`), not the full mini-reports.
5. **Persistence** — hypotheses are saved per date range in
   `chrome.storage.local` under **`hypothesis_drafts`** (keyed by range), so
   they survive a panel reload and re-appear when the same range is selected.
   The user was *"indifferent"* about persistence but agreed it made sense.

See [DECISIONS.md D31](DECISIONS.md#d31).

---

## 7. Live-refresh suggestion tile

The "stuck on 8" symptom: the suggestions metric tile didn't re-render when the
review queue changed (accept/reject/apply). Folded into this sweep since the
area was already open. `sidepanel.js` now re-renders the suggestion tile on
library mutations. Small, separate concern from the outcome-driven rework in
§1, but they compounded to make the count look frozen.

See [DECISIONS.md D33](DECISIONS.md#d33).

---

## 8. Best-effort LLM text polish

*"When I add this week's ask, can you add an LLM call to check spelling and
grammar that cleans up the grammar if there is a successful connection but if
there is none does not fail and just uses what is there."* Also applied to the
hypothesis bullets before they're sent into the WPSA prompt — *"so the correct
version is sent into the prompt, I don't have to intervene except it is not
necessary."*

[lib/text-polish.js](../lib/text-polish.js):

- `polishText(input, { timeoutMs = 5000 })` — **always returns a string**,
  callers never handle errors. Skips the LLM for input `< 10` chars. On
  timeout / failure / no provider → returns the original. Sanity guard: if the
  cleaned text is `> 2.5×` the original length (LLM went off-script, e.g.
  *"Sure! Here's the cleaned…"*), returns the original.
- `polishBullets(bullets, opts)` — polishes each independently; per-bullet
  failure falls back to that bullet's original; preserves order and count.
- Tight system prompt: fix mechanics only, no paraphrasing, output only the
  cleaned text.

Wired in `sidepanel.js`: `polishText(askRaw)` on the weekly ask (line ~1290),
`polishBullets(...)` on hypotheses before building the prompt (line ~1153).

See [DECISIONS.md D32](DECISIONS.md#d32).

---

## New storage keys / fields introduced by this batch

| Location | Key / field | Purpose |
|---|---|---|
| `chrome.storage.local` | `hypothesis_drafts` | Per-date-range saved hypotheses (object keyed by range). |
| `draft_log` entry | `outcome_at` | ISO timestamp of first outcome transition. |
| `draft_log` entry | `final_used_text`, `final_used_verbatim`, `chosen_version`, `manager_rewrite_text`, `library_entry_id` | Consumed by the outcome-driven suggestion funnel (some pre-existed; all are load-bearing now). |
| library `suggestion` | `resolved_at`, `draft_id`, `status` | Range-based resolution counts + idempotency guard. |
| library `entry` | `created_at`, `source` | Range-based library growth + generated-count. |

Update [INTEGRATIONS.md §Storage layout](INTEGRATIONS.md#storage-layout) to add
`hypothesis_drafts` if it isn't there yet.

---

## Tests added this batch (all green at ship)

`tests/integration/outcome-suggestion-flow.test.js`,
`tests/integration/report-range-wiring.test.js`,
`tests/ui/hypothesis-persistence.test.js`,
`tests/ui/searchable-select.test.js`,
`tests/ui/sidepanel-searchable-dropdowns.test.js`,
`tests/ui/suggestion-tile-live-refresh.test.js`,
`tests/unit/audit-metrics-ranges.test.js`,
`tests/unit/diff-text.test.js`,
`tests/unit/maybe-propose-from-outcome.test.js`,
`tests/unit/outcome-at-stamping.test.js`,
`tests/unit/prompt-generator-hypotheses.test.js`,
`tests/unit/report-html-hypotheses.test.js`,
`tests/unit/report-html-split-stats.test.js`,
`tests/unit/report-slack-split-stats.test.js`,
`tests/unit/text-polish.test.js`,
`tests/unit/wpsa-schema-hypotheses.test.js`.

The user's process note for the batch: *"do it in one sweep but splice the
commits at reasonable boundaries"* — hence the 9 commits above.
