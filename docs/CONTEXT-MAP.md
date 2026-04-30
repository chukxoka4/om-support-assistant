# Context Map — read this first

If you're new here — a fresh AI, a new contributor, future-me on a different account — read this once and the rest of the repo will make sense.

---

## What this is

A **Chrome MV3 extension** for one support agent ([Nwachukwu Okafor](https://github.com/chukxoka4)) at OptinMonster. It does three things:

1. **Reviews support drafts** before they're sent — paste a rough draft + context, the AI returns two rewrites + a reason. The agent picks one, copies/inserts into the OM ticket editor.
2. **Learns** from manager edits — every managerial rewrite enqueues an LLM-proposed library refinement. The human reviews and applies (no auto-apply, ever).
3. **Reports** weekly insights to the agent's manager — combines extension-internal AI-loop metrics (Section 2) with WPSA AI's product-friction analysis (Sections 1 & 3). Outputs a self-contained HTML file + Slack-ready markdown snippet.

The extension also surfaces:
- **Customer health context** from Intercom on every ticket page (plan, tenure, engagement, custom attributes), feeding it into compose so rewrites are personalised.
- **Library suggestions** under the draft textarea (top 5 ranked entries) before the agent hits Generate.
- **Quick transforms** — right-click a selection on any page → fix grammar / make friendlier / translate to 22 languages.

It's not a generic SaaS. It's one person's daily tool, built to satisfy a specific supervisor's Q2/Q3 expectations and to demonstrate the company's [AI Adoption Rubric](docs/01-PRODUCT.md#where-this-sits-on-the-ai-adoption-rubric-today). Treat that as a feature, not a bug — every design decision flows from that constraint.

---

## How to read this repo

There are five layers to the project. They map to five families of documents.

```
┌─────────────────────────────────────────────────────────────────────┐
│ STRATEGY — why this exists, what success looks like                  │
│   docs/06-REVIEW-PLAN.md   supervisor expectations + May 1 pitch     │
│   docs/07-WPSA-REPORTER.md WPSA AI workflow, prompt library          │
├─────────────────────────────────────────────────────────────────────┤
│ PRODUCT — what's built, what's planned, what's deferred              │
│   docs/01-PRODUCT.md       present / on-going / future state         │
│   docs/02-BUGS.md          A1–E4 bug plan with status                │
│   docs/03-FEATURES.md      F1–F8 feature plan with status            │
│   docs/04-MOCKUPS.md       text mockups for visual review            │
├─────────────────────────────────────────────────────────────────────┤
│ SYSTEM — how it's wired                                              │
│   ARCHITECTURE.md          five-layer split, MV3 constraints         │
│   docs/INTEGRATIONS.md     WPSA, Intercom, Summernote glossary       │
│   docs/AUDIT-AND-REPORT.md the weekly digest dossier                 │
├─────────────────────────────────────────────────────────────────────┤
│ DECISIONS — why we did it this way                                   │
│   docs/DECISIONS.md        non-obvious calls + the reasoning         │
│   docs/OPEN-THREADS.md     parked items not yet filed                │
├─────────────────────────────────────────────────────────────────────┤
│ DAY-TO-DAY — how to work on it                                       │
│   docs/CONVENTIONS.md      branch model, commit norms, test gates    │
│   docs/05-TESTS.md         test plan, framework, coverage targets    │
└─────────────────────────────────────────────────────────────────────┘
```

If you're tasked with…

| You're doing | Read first | Then |
|---|---|---|
| **Fixing a bug** | [docs/02-BUGS.md](docs/02-BUGS.md) | [ARCHITECTURE.md](ARCHITECTURE.md), [docs/CONVENTIONS.md](docs/CONVENTIONS.md) |
| **Building a planned feature** | [docs/03-FEATURES.md](docs/03-FEATURES.md) | [ARCHITECTURE.md](ARCHITECTURE.md), the relevant `lib/*.js` |
| **Touching the digest / audit / WPSA flow** | [docs/AUDIT-AND-REPORT.md](docs/AUDIT-AND-REPORT.md) | [docs/07-WPSA-REPORTER.md](docs/07-WPSA-REPORTER.md), [lib/wpsa-schema.js](../lib/wpsa-schema.js) |
| **Touching Intercom / customer chip** | [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) | [lib/intercom-client.js](../lib/intercom-client.js), [lib/intercom-snapshot.js](../lib/intercom-snapshot.js) |
| **Anything that touches drafts, library, suggestions** | [docs/01-PRODUCT.md](docs/01-PRODUCT.md) §Library | [lib/storage.js](../lib/storage.js), [lib/library.js](../lib/library.js), [lib/compose.js](../lib/compose.js) |
| **Wondering "why was it built this way?"** | [docs/DECISIONS.md](docs/DECISIONS.md) | [docs/OPEN-THREADS.md](docs/OPEN-THREADS.md) for unfinished arguments |
| **Wondering "is anyone working on X?"** | [docs/OPEN-THREADS.md](docs/OPEN-THREADS.md) | [docs/03-FEATURES.md](docs/03-FEATURES.md) |
| **First time, just orienting** | this file | then [ARCHITECTURE.md](ARCHITECTURE.md) |

---

## The 60-second tour

**Stack:** Chrome MV3 extension. ESM, no build step, no bundler, no TypeScript. Tests via Vitest + happy-dom.

**Five layers** ([ARCHITECTURE.md](ARCHITECTURE.md) is the spec):

```
1. Entry points       background.js · sidepanel.js · options.js · content scripts
2. Services           lib/compose.js · lib/voice.js · lib/library.js · lib/library-rank.js
                      lib/suggestions.js · lib/intercom-snapshot.js · lib/audit-metrics.js
                      lib/report-html.js · lib/prompt-generator.js · lib/quick-transform.js
3. Repositories       lib/storage.js · lib/intercom-client.js · lib/ticket.js · lib/html.js
                      lib/toast.js · lib/wpsa-schema.js · lib/paginate.js · lib/charts.js
4. Infrastructure     providers/{gemini,claude,openai}.js · providers/index.js
5. Data               prompts/om-seeds.json · prompts/house-style.md · prompts/products/*.md
```

**Core entities in storage:**
- `library_v3` (`chrome.storage.local`) — seeded prompt library + auto-grown entries. 18 seeds at install. Score weights: manager_approved=5, sent_as_is=2, rewrites_absorbed=1, initial_uses=0.25.
- `draft_log` (`chrome.storage.local`) — every compose, every quick transform, every Step-1/Step-2 outcome. Append-only.
- `intercom_config`, `report_config`, `api_keys`, `default_provider`, `ranker_mode` (`chrome.storage.sync`) — user settings, cross-device.
- `intercom_snapshot_cache` (`chrome.storage.session`) — 5-minute per-email customer snapshots.

**The compose pipeline** ([lib/compose.js](../lib/compose.js)):
1. Build system prompt: role → house style → output contract → dropdowns → scenario instruction → optional library task → customer context (Intercom) if available.
2. Build user prompt with the rough draft.
3. Dispatch to provider via [providers/index.js](../providers/index.js).
4. Parse `REASON / VERSION A / VERSION B / CLEAN_PROMPT / SCENARIO_SUMMARY`. If parse fails, surface raw text with a "couldn't parse" banner.
5. Auto-grow library if no preset was used (PII guard before saving).
6. Log full draft record to `draft_log`.

**The two-step revisit loop:**
- Step 1 (after Copy/Insert): "What went forward?" — `as_copied` / `edited` / `manager_first`.
- Step 2 (after manager review): `sent` / `manager_approved` / `managerial_rewrite`. The third also enqueues a library-refinement suggestion via [lib/suggestions.js](../lib/suggestions.js).

**The library-learning loop (now wired):**
1. Manager rewrites a draft → fire-and-forget call to `proposeSuggestion`.
2. LLM compares AI reply to manager's final → returns a structured proposal (refine_instruction / new_tone / new_audience / new_goal / split_entry).
3. Suggestion lands on the entry's `pending_suggestions` queue with `status: "pending"`.
4. Agent reviews via the side-panel queue. Accept opens a preview; Apply commits the change. Reject / Defer leave the entry untouched. **No auto-apply, ever.** ([Decision D2](docs/DECISIONS.md))

**The customer chip (F2):**
- Shipped, US-region only.
- On a ticket page with an Intercom key configured, scrapes the customer email(s) from `ul.customer-contacts li.customer-email`, fetches a snapshot per email, renders a one-line health summary at the top of the panel.
- Click ↻ to refresh, ▾ to expand, type into the manual-email field to look up anyone.
- Health rules are subscription + engagement based ([Decision D9](docs/DECISIONS.md)) — OM does not use Intercom for support tickets, so conversation counts are always zero and were dropped from the rules.

**The Audit tab (the May 1 pitch):**
- Bottom-of-panel section that produces a weekly self-contained HTML report + a Slack-ready markdown snippet.
- Three sections in the report: Personal stats from WPSA, AI-loop progress from the extension, Customer insights from WPSA team scope.
- Charts inline SVG, no CDN, no `<script>`. Single file, downloads via Blob.
- WPSA prompt is generated programmatically by [lib/prompt-generator.js](../lib/prompt-generator.js) — agent picks scope/dates/agent name, clicks Copy, pastes into WPSA AI.
- Schema validation by [lib/wpsa-schema.js](../lib/wpsa-schema.js) — strict enums on the O+I framework fields ([Decision D11](docs/DECISIONS.md)).

---

## What's shipped vs what's planned

```
SHIPPED (as of 2026-04-30):
  Bug A1   Retire dead v2 library store
  Bug A2   Wire Options Export / Import / Reset to v3
  Bug A3   Visible toasts for library actions
  Bug B1   Remove dead `edited` / `rewrote` / `correction_logged`
  Bug C1   Wire proposeSuggestion on managerial rewrite
  Bug C2   Suggestion accept opens preview; Apply mutates; no auto-apply
           (+ multi-change apply follow-up)
  Bug D1   Graceful fallback when parseStructuredOutput fails
  Bug D2   PII regex guard before auto-add to library
  Bug D3   6-field findEquivalent (instruction prefix as 5th dimension)
  Bug "Window-pin" Pin tab queries to cached windowId; warn-toast on null ticket
  Bug "Quick-transform pause"  Filter quick-transforms out of ticket-page listener

  Feature F1  In-textarea library suggestions strip with Lex/LLM toggle
  Feature F2  Intercom client + snapshot in panel + customer chip + compose context
  Audit tab + report generator + WPSA prompt builder (the May 1 pitch)
  Library & Learning re-layout: tabs, pagination, filter chips, tile-jump
  Orphaned-draft recovery via console snippet (manual procedure)

PLANNED:
  Bugs E1-E4   Polish (safe truncation, max_tokens, dismissal expiry, dedupe)
  Feature F3   Outreach mode
  Feature F4   Cross-ticket synthesis (deferred until F3 + real volume)
  Feature F5   TrustPulse / Beacon product toggle (small)
  Feature F6   Rich-text editor for draft / prompt / manager-rewrite
  Feature F7   Orphaned-draft finder + relink button (UI for the manual recovery)
  Feature F8   Single-writer for draft_log (concurrency hardening)
```

Status of every bug and feature is tracked in [docs/02-BUGS.md](docs/02-BUGS.md) and [docs/03-FEATURES.md](docs/03-FEATURES.md). When you ship something, **update that status in the same commit.**

---

## Working norms (the short version — full version in [CONVENTIONS.md](CONVENTIONS.md))

- One working branch: `joseph-dev`. Merge to `main` for releases. **No bug-fix sub-branches.**
- Every commit that touches `lib/`, `providers/`, `mcp-intercom/`, or top-level entry points must touch `tests/` too. The Husky pre-commit hook enforces this.
- All tests must pass before commit. **Never use `--no-verify`** without explicit user sign-off in the same conversation.
- Commits use a `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>` trailer.
- Architecture violations are ineligible by default. If you must violate a layer, leave a one-line `// ARCHITECTURE VIOLATION:` comment and file it in [docs/02-BUGS.md](docs/02-BUGS.md).
- Doc changes are commit-friendly without test changes (the hook only gates code).
- Pre-code checklist: read [ARCHITECTURE.md §Pre-code checklist](ARCHITECTURE.md#pre-code-checklist-use-this-every-time) before any non-trivial change.

---

## A few hard truths future-you should know

1. **This was built one feature at a time over a few weeks of pair-programming.** The git history is detailed; commit messages explain the *why* most of the time. Read them.
2. **Tests are the spec.** When two docs disagree, the tests win. They've never been wrong; the docs sometimes drift.
3. **The personal layer is real.** This is not abstract software — it's tied to one agent's job at one company with one supervisor's expectations. Some choices will look weird unless you read [docs/06-REVIEW-PLAN.md](docs/06-REVIEW-PLAN.md). For example, the WPSA prompt generator hardcodes "OptinMonster" because that's what the agent is on. F5 widens it.
4. **There's no MCP server.** [docs/03-FEATURES.md F2](docs/03-FEATURES.md) originally proposed one; we removed it ([Decision D8](docs/DECISIONS.md)). Don't re-add it without re-litigating the trade-off.
5. **Intercom is US-only and the agent has no Intercom UI access.** Field probing in [lib/intercom-client.js](../lib/intercom-client.js) is defensive (multiple keys per concept) because we discover schema by inspecting actual responses ([Decision D10](docs/DECISIONS.md)). When in doubt, log raw responses to console; don't guess.
6. **The manager is a real person with real expectations.** The May 1 pitch in [docs/06-REVIEW-PLAN.md](docs/06-REVIEW-PLAN.md) drives a lot of what got built. Don't break the digest format casually.

---

## When you're done with whatever you came here to do

1. Update the status in [docs/02-BUGS.md](docs/02-BUGS.md) or [docs/03-FEATURES.md](docs/03-FEATURES.md).
2. If you made a non-obvious decision, add a short entry to [docs/DECISIONS.md](docs/DECISIONS.md).
3. If you noticed something we should track but isn't a feature yet, drop it in [docs/OPEN-THREADS.md](docs/OPEN-THREADS.md).
4. If you broke a doc by shipping something, update the doc in the same commit.

That's the contract. The rest is style.
