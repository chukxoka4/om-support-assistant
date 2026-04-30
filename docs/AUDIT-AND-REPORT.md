# Audit & Weekly Report — feature dossier

The May 1 supervisor pitch made testable. This is the most fully-realised single feature in the repo and it spans seven library modules. This dossier exists so you don't have to reverse-engineer the flow from code.

If you're touching anything related to the weekly digest, the WPSA prompt builder, the Audit tab UI, or the chart rendering — start here.

---

## What it does

A weekly workflow that produces:

1. A **self-contained HTML report** the agent's manager opens in a browser. Inline SVG charts, embedded CSS, no `<script>`, no external assets. Email-attachable, Slack-attachable, viewable offline.
2. A **Slack-ready markdown snippet** copied to the clipboard at the same time. The agent posts the snippet in Slack and attaches the HTML for anyone wanting the full picture.

Three sections in the report:

- **Section 1 — Personal stats from WPSA** — the agent's own week (totals, categories pie, happiness with sample size).
- **Section 2 — How the AI loop is helping me** — extension-internal metrics (library size, suggestion CTR, customer-context coverage, Ready-to-Send rate).
- **Section 3 — Customer insights** — team-wide friction leaderboard, time-waster, O/I verdict, knowledge gaps from the WPSA AI's analysis.

Optional **Section 4 — One ask** — a single highlighted request to the team / product when the agent has one.

---

## The Friday flow

Roughly 8 minutes once familiar.

1. Open side panel → scroll to "Library & Learning" → expanded by default. Above it, the **Weekly audit & report** section.
2. Click to expand the audit panel. **Build WPSA prompt** block at the top.
3. Confirm dates (default: previous Mon → Sun), pick scope (Personal first), confirm "Analyse tickets for" name (default: your saved name).
4. Click **Generate prompt** → fills the textarea. Click **Copy prompt**.
5. Switch to WPSA → set ticket filter to *your tickets only* → paste prompt into the AI chat → run → copy the JSON output.
6. Back in the side panel → paste into the **Personal WPSA JSON** textarea. Live validator turns green ✓.
7. Toggle scope to **Team**, click Generate, Copy. WPSA → set filter to *whole team* → paste → run → copy. Paste into the **Team WPSA JSON** textarea.
8. Optional: type the week's ask in the **This week's ask** field.
9. Click **Generate weekly report**. The HTML downloads. The Slack snippet is on your clipboard.
10. Post the snippet in Slack and attach the HTML.

Section 2 is computed automatically from extension storage; the agent doesn't paste anything for it.

---

## The data flow

```
                  ┌────────────────────────────────┐
                  │ WPSA AI Reporter (external)    │
                  │   filtered by personal / team  │
                  └────┬───────────────────────────┘
                       │ JSON output (paste)
                       ▼
                  ┌────────────────────────────────┐
                  │ lib/wpsa-schema.js             │
                  │   parseWpsaJson +              │
                  │   validateWpsaShape (enums)    │
                  │   normalises optional fields   │
                  └────┬───────────────────────────┘
                       │ { ok, errors[], normalised }
                       ▼
┌───────────────────────────────────────────┐
│ Audit tab state (sidepanel.js):           │
│   lastValidatedPersonal                   │
│   lastValidatedTeam                       │
└──────┬────────────────────────────────────┘
       │ + chrome.storage.local data
       │ + extension's own metrics
       ▼
┌───────────────────────────────────────────┐
│ lib/audit-metrics.js                      │
│   computeAuditMetrics({drafts, library})  │
│   Section 2 numbers                        │
└──────┬────────────────────────────────────┘
       │
       ▼
┌─────────────────────┐  ┌────────────────────┐
│ lib/report-html.js  │  │ lib/report-slack.js│
│   buildReportHtml   │  │   buildSlackSnippet│
└──────┬──────────────┘  └─────┬──────────────┘
       │ self-contained HTML    │ markdown text
       │                        │
       ▼                        ▼
   <a download>          navigator.clipboard
```

### Per-module breakdown

#### [lib/prompt-generator.js](../lib/prompt-generator.js)

Pure module. `buildWpsaPrompt({ scope, weekStart, weekEnd, agent })` returns the full prompt string for either personal or team scope, with dates and agent baked into the schema body. Deterministic — same inputs produce byte-identical output. Also exports `previousMondayToSunday(now)` for the "previous full week" date defaults.

The prompt includes the strict O+I framework rules ([DECISIONS.md D11](DECISIONS.md#d11)):
- `primaryGrowthLever` enum: `churn / reactivations / upgrades / cost_reduction / none`
- `mveBootstrap` — one-sentence "scrappier alternative first" answer
- `escalationVerdict` enum: `playbook_only / escalate / watch`

#### [lib/wpsa-schema.js](../lib/wpsa-schema.js)

Validator + normaliser for the AI's JSON output. `parseWpsaJson(rawText)` tolerates markdown code fences and stray prose around the JSON, then validates against the schema. Returns `{ ok, errors, normalised }`.

Strict enums:
- friction `sentiment`: `frustrated / confused / accepting / urgent`
- friction `rootCause`: `ui_workflow / documentation_gap / known_issue / product_gap`
- timeWaster `category`: `product_friction / process_repetition`
- oiVerdict `verdict`: `yes / no / conditional` (legacy)
- oiVerdict `inputEffort`: `low / medium / high / unknown`
- oiVerdict `primaryGrowthLever`: 5-value enum above
- oiVerdict `escalationVerdict`: 3-value enum above
- meta `scope`: `personal / team`

Required fields: `meta.weekStart`, `meta.weekEnd`, `totals.conversations`, `totals.replies`, at least one `category`, 1–3 `frictionLeaderboard` entries.

Optional fields with safe-default normalisation: `timeWaster`, `oiVerdict`, `knowledgeGaps`, `caveats`, `meta.agent`, `meta.product`. Missing optionals become `null` or `[]` so the renderer can rely on shape.

#### [lib/audit-metrics.js](../lib/audit-metrics.js)

Pure aggregations from `draft_log` + `library_v3`. Section 2 numbers:

| Metric | Formula |
|---|---|
| `library.total` | Count of entries in `library_v3` |
| `library.addedThisWeek` | Entries with `created_at` ≥ now-7d |
| `library.rewritesAbsorbedAllTime` | Sum of `score.rewrites_absorbed` across all entries |
| `librarySeries` | `[{ x: "MM-DD", y: <count of entries created on or before that day> }]` for the last 7 days |
| `suggestions.pending` | Pending `pending_suggestions` across all entries |
| `suggestions.appliedThisWeek` | Suggestions with status `applied` and `resolved_at` ≥ now-7d |
| `suggestions.rejectedThisWeek` | Same with status `rejected` |
| `suggestions.deferredThisWeek` | Same with status `deferred` |
| `suggestionCtr` | `{ total, clicked, ratePercent }` from `draft_log[].suggestion_log.impression_ids` and `clicked_id` |
| `customerContext` | `{ total, withContext, ratePercent }` — % of compose drafts with `customer_context_used: true` |
| `readyToSend` | `(sent + manager_approved) / drafts-with-any-outcome × 100` (recent 7d, compose only) |

The "Ready-to-Send rate" footnoted as personal-review-pattern in the rendered report ([DECISIONS.md D25](DECISIONS.md#d25)).

#### [lib/charts.js](../lib/charts.js)

Inline-SVG chart generators. ~120 lines, no library dependency (MV3 CSP forbids CDN). Five exports:

- `counter({ label, value, footnote })` — plain HTML card.
- `bar(items, { width, rowHeight, gap, valueSuffix })` — horizontal bars, one per item.
- `pie(slices, { size })` — pie + legend wrapper.
- `line(data, { width, height, valuePrefix })` — line chart with dots and y-axis labels.
- `stackedBar(items, { width, height, valueSuffix })` — single horizontal stacked row + legend.

All return SVG strings. Empty input returns a `<div class='empty-chart'>no data</div>` fallback. HTML escaping via internal helper.

#### [lib/report-html.js](../lib/report-html.js)

`buildReportHtml({ personalWpsa, teamWpsa, audit, ask, reportAuthor })` returns a full self-contained HTML document. CSS inlined. No `<script>`, no `<link>`. Charts inlined.

Key rendering rules:

- **Header attribution:** if `personalWpsa.meta.agent !== reportAuthor` and both present → "About X · prepared by Y." If they match → "By X." If both blank → just the date range. ([DECISIONS.md D11 spec](DECISIONS.md#d11))
- **O/I card headline** is the **escalation verdict** (ESCALATE / PLAYBOOK ONLY / WATCH), colour-coded. The legacy `verdict` (yes/no/conditional) is shown as a small pill alongside.
- **Growth lever pill** colour-coded: red for churn, amber for reactivations, green for upgrades, indigo for cost_reduction, grey for none.
- **Bootstrap option line** appears italicised when `mveBootstrap` is non-null.
- **Caveats footer** lists the AI's own caveats (sample-size warnings, data heuristics).
- **HTML escaping** runs on every user-provided text field. XSS-safe.

#### [lib/report-slack.js](../lib/report-slack.js)

`buildSlackSnippet(...)` returns a markdown-formatted text block suitable for a Slack message. Same input contract as `buildReportHtml`. Three sections present when their inputs are present; gracefully degrades when only one is provided.

Format:
```
*Weekly Support Insights — 2026-04-19 → 2026-04-25* · By Nwachukwu Okafor

*1. My week*
• 93 conversations · 157 replies
• Happiness: 3 good · 0 bad (n=4)
• Top categories: Cancellation Request (38), General Support (27), Other Billing (15)

*2. AI loop progress*
• Library: 24 entries (+3 this week), 7 rewrites absorbed
• Suggestions: 5 resolved (4 applied · 1 rejected · 0 deferred), 2 pending
• Suggestion strip CTR: 58% (7/12)
• Customer-context coverage: 80% (24/30 replies)
• Ready-to-Send rate: 91% _(personal review pattern)_

*3. What customers are saying*
• 184 conversations · 414 replies
• #1 friction: *Refund & Auto-Renewal Policies* — 38 convos, 45 msgs (frustrated)
• O/I escalation: *ESCALATE* on _Kit Integration Lead Sync_ — Lever: *churn*, input effort: low, ~1.5h/week saved
   _Clarifying the Double Opt-in requirement..._
• Time-waster: Free Plan Limits and Upgrades (4 occurrences) — saved-reply drafted

*Ask:* Promote the unified-device feature from early access to GA.

_Full report attached as HTML — click to open in browser._
```

#### [lib/paginate.js](../lib/paginate.js)

Tiny paginator helper. `paginate(items, page, perPage = 10)` → `{ rows, page, totalPages, totalItems }`. Clamps page to range. Used by the Library & Learning panel tabs (not directly the audit flow, but lives in the same docs because it's part of the same UI).

---

## The Audit tab UI

### Layout

```
┌─ Weekly audit & report ▾ ─────────────────────────────────────┐
│                                                                │
│ Build WPSA prompt                                              │
│   Scope: ( ◉ Personal · ○ Team )                               │
│   From: [date] · To: [date]                                    │
│   Analyse tickets for: [Nwachukwu Okafor          ]            │
│   [ Generate prompt ] [ Copy prompt ]                          │
│   [textarea — generated prompt appears here]                   │
│   ✓ Prompt generated. Click Copy and paste into WPSA AI.       │
│                                                                │
│ Section 1 — My personal stats from WPSA                        │
│   [textarea — paste personal WPSA JSON]                        │
│   ✓ Parsed · 93 conversations                                  │
│                                                                │
│ Section 2 — AI loop metrics (live, from this extension)        │
│   • Library: 24 entries (+3 this week), 7 rewrites absorbed    │
│   • Suggestions: 5 resolved (4 applied · 1 rejected · …) ...    │
│   • Suggestion strip CTR: 58% (7/12)                           │
│   • Customer-context coverage: 80% (24/30 replies)             │
│   • Ready-to-Send rate: 91% (personal review pattern)          │
│                                                                │
│ Section 3 — Team customer insights                             │
│   [textarea — paste team WPSA JSON]                            │
│   ✓ Parsed · 184 conversations · 1 friction items              │
│                                                                │
│ This week's ask (optional)                                     │
│   [Promote the unified-device feature to GA               ]    │
│                                                                │
│ [ Generate weekly report ]  [ Copy Slack snippet ]             │
│ ✓ Downloaded weekly-support-insights-2026-04-25.html ·         │
│   Slack snippet copied to clipboard                            │
└────────────────────────────────────────────────────────────────┘
```

### Wiring in [sidepanel.js](../sidepanel.js)

- `auditToggle` click expands/collapses the panel; on expand, calls `refreshAuditLiveMetrics()` and `initPromptBuilder()`.
- `auditPersonalJson` / `auditTeamJson` `input` listeners run `parseWpsaJson` live, surface ✓ / ✗ status with the parse-error message.
- `promptScope` change auto-fills the agent field (your name for Personal, "Team" for Team) only when the field is empty, "Team", or matches the saved author name. Manual edits to teammate names are preserved.
- `promptGenerate` click runs `buildWpsaPrompt` with the form values, populates the textarea.
- `promptCopy` click writes to `navigator.clipboard.writeText`.
- `auditGenerate` click:
  1. Validates at least one of personalWpsa / teamWpsa is parsed.
  2. Computes audit metrics fresh.
  3. Calls `buildReportHtml(...)` with the inputs + report-author from `getReportConfig()`.
  4. Calls `buildSlackSnippet(...)` with the same inputs.
  5. Creates a Blob, anchor with `download` attribute, clicks it.
  6. Writes the snippet to clipboard.
  7. Surfaces a green status + toast.
- `auditCopySlack` click rebuilds the snippet on demand and copies it.

---

## Test coverage

Unit:
- [tests/unit/prompt-generator.test.js](../tests/unit/prompt-generator.test.js) (12) — input validation, personal scope bakes agent + dates, team forces "Team", "You" fallback, schema body has the new oiVerdict enums, determinism, `previousMondayToSunday` on Mon/Sun/Tue.
- [tests/unit/wpsa-schema.test.js](../tests/unit/wpsa-schema.test.js) (~18) — accepts the actual WPSA AI output, strips markdown fences and prose, rejects bad enums, normalises missing optional fields.
- [tests/unit/audit-metrics.test.js](../tests/unit/audit-metrics.test.js) (~9) — every aggregation, edge cases, integration shape.
- [tests/unit/charts.test.js](../tests/unit/charts.test.js) (~12) — counter / bar / pie / line / stacked, structure, empty-data fallbacks, HTML escaping.
- [tests/unit/report-html.test.js](../tests/unit/report-html.test.js) (~14) — full document shape, all sections present, audit metrics carried, friction leaderboard styling, evidence ticket IDs surfaced, Section 4 conditional, no-data section graceful, CSS inlined no external `<link>`/`<script>`, HTML escapes user-provided text (XSS), pill + verdict + bootstrap rendering, header attribution rules.
- [tests/unit/report-slack.test.js](../tests/unit/report-slack.test.js) (~9) — title with week range and agent, all three sections when full input, audit numbers, top friction lead, ask conditional, single-section graceful render, lever + verdict line, About / prepared by attribution.
- [tests/unit/paginate.test.js](../tests/unit/paginate.test.js) (9) — bounds, clamping, defaults.
- [tests/unit/report-config-storage.test.js](../tests/unit/report-config-storage.test.js) (4) — round-trip, default empty, sync-storage key.

UI:
- [tests/ui/library-panel-tabs.test.js](../tests/ui/library-panel-tabs.test.js) — pagination, filter chips, metric tile clicks (the Library & Learning host).
- [tests/ui/sidepanel-strip.test.js](../tests/ui/sidepanel-strip.test.js) — F1 strip behaviour around expand / Clear / programmatic input.

If you add a feature that touches this flow, the test counts above are the baseline. Update them in your commit.

---

## Things that might surprise you

- **The personal scope's `oiVerdict` is usually null.** That's expected — personal ticket volume is too small for meaningful escalation verdicts. The team-scope JSON is where the O/I work happens. The renderer handles `null` cleanly.
- **The Audit tab's Section 2 metrics are computed at click-time, not when you paste.** So the "live metrics" you see at the top reflect storage at panel open, but the report uses fresh values at Generate. If a draft lands between opening the panel and clicking Generate, the report will include it.
- **The HTML download filename uses `meta.weekEnd`** when present, falling back to today's date. Consistent week-over-week filing.
- **`buildReportHtml` is called with at least one of personalWpsa / teamWpsa / audit non-null.** All-null doesn't blow up — you'd get an empty shell with the "No personal WPSA JSON provided" / "No team WPSA JSON provided" empty-state blocks. Useful for mid-week dry runs.
- **The Slack snippet line about CTR is computed differently from the report's tile.** Report tile shows "58%" with footnote "7/12 impressions"; Slack inlines as "58% (7/12)". Keep both honest in formatter changes.
- **`reportAuthor` lives in `chrome.storage.sync` under `report_config: { agentName }`.** Set in side-panel Settings or Options page (mirrored). Both UIs edit the same key.

---

## Where to look when something breaks

| Symptom | First file | Then |
|---|---|---|
| WPSA JSON validator rejects a real response | [lib/wpsa-schema.js](../lib/wpsa-schema.js) | The AI's actual output — usually an enum drift; either widen the validator or tighten the prompt rules in [lib/prompt-generator.js](../lib/prompt-generator.js) |
| Section 2 numbers look wrong | [lib/audit-metrics.js](../lib/audit-metrics.js) | The matching test in [tests/unit/audit-metrics.test.js](../tests/unit/audit-metrics.test.js) |
| Report HTML renders blank | [lib/report-html.js](../lib/report-html.js) | Check that at least one of personalWpsa/teamWpsa/audit is truthy |
| Charts look broken | [lib/charts.js](../lib/charts.js) | The fallback `<div class='empty-chart'>` shows when input is empty/zero |
| Clipboard copy fails | Browser permissions | Modern Chrome requires the side panel to have focus; `navigator.clipboard.writeText` only works from a user gesture |
| Filename clashes | [sidepanel.js](../sidepanel.js) `auditGenerate` | Currently uses `meta.weekEnd`; for two reports same day same range, the second overwrites the first download |
| Prompt generator output drifts week-over-week | [lib/prompt-generator.js](../lib/prompt-generator.js) | Should be byte-identical for same inputs; if not, check date formatting |
