# OM Support Assistant — Documentation Index

Living planning + reference docs. Read in order if you're new; jump to whichever fits the task you're on.

**First time here?** Read [CONTEXT-MAP.md](CONTEXT-MAP.md). It explains what the project is, who it's for, the constraints, and which doc to read for which task. Everything below presumes you've read that one.

**Before writing any code:** read [../ARCHITECTURE.md](../ARCHITECTURE.md). It is the source of truth for layers, naming, and what goes where.

---

## The docs

### Orientation

- **[CONTEXT-MAP.md](CONTEXT-MAP.md)** — *read this first.* What this project is, who it's for, the five doc-families, the 60-second tour, hard truths.
- **[../ARCHITECTURE.md](../ARCHITECTURE.md)** — five-layer split, MV3 constraints, naming rules, pre-code checklist.
- **[../README.md](../README.md)** — install, top-level architecture diagram. Deliberately thin.

### Strategy and process

- **[06-REVIEW-PLAN.md](06-REVIEW-PLAN.md)** — Q2/Q3 supervisor expectations, the May 1 reporting pitch, two-week build plan, honest gaps.
- **[07-WPSA-REPORTER.md](07-WPSA-REPORTER.md)** — WPSiteAssist reporting tool: Friday workflow, prompt library, drift hygiene.
- **[CONVENTIONS.md](CONVENTIONS.md)** — branch model, commit norms, pre-commit hook contract, test rules, naming, doc discipline.

### Product / state

- **[01-PRODUCT.md](01-PRODUCT.md)** — present / on-going / future state of the product.
- **[02-BUGS.md](02-BUGS.md)** — A1–E4 bug plan with shipped/open status.
- **[03-FEATURES.md](03-FEATURES.md)** — F1–F8 feature plan with shipped/planned status.
- **[04-MOCKUPS.md](04-MOCKUPS.md)** — text mockups for visual review before UI is built.

### System reference

- **[INTEGRATIONS.md](INTEGRATIONS.md)** — WPSA, Intercom, Summernote glossary; provider dispatch; storage layout; integration-debugging table.
- **[AUDIT-AND-REPORT.md](AUDIT-AND-REPORT.md)** — the weekly digest as one feature dossier (the most fully-realised feature, spans 7 modules).

### Testing

- **[05-TESTS.md](05-TESTS.md)** — test plan, framework choice, coverage targets, helpers.

### Reasoning and follow-ups

- **[DECISIONS.md](DECISIONS.md)** — non-obvious calls + the reasoning, ADR-lite. Read before re-litigating something.
- **[OPEN-THREADS.md](OPEN-THREADS.md)** — parking lot for items mentioned but not yet filed.

---

## Rules of the road

- No file gets a feature change without a test added in the same commit.
- Every test must pass before commit (the Husky pre-commit hook enforces this; see [CONVENTIONS.md](CONVENTIONS.md)).
- Bugs and features get their status updated in the same commit they ship in. See [02-BUGS.md](02-BUGS.md) and [03-FEATURES.md](03-FEATURES.md).
- Mockups get human review before any UI code is written.
- Plans are living: when reality changes, the doc changes in the same commit as the code.
- If you make a non-obvious decision, add a short entry to [DECISIONS.md](DECISIONS.md).
- Branch model: single working branch `joseph-dev`. No bug-fix sub-branches.

---

## Architecture layers (recap)

```
Entry points       background.js · content scripts · sidepanel.js · options.js
Services           lib/compose.js · lib/voice.js · lib/library.js · lib/library-rank.js
                   lib/suggestions.js · lib/intercom-snapshot.js · lib/audit-metrics.js
                   lib/report-html.js · lib/prompt-generator.js · lib/quick-transform.js
                   providers/index.js
Repositories       lib/storage.js · lib/intercom-client.js · lib/ticket.js · lib/html.js
                   lib/toast.js · lib/wpsa-schema.js · lib/paginate.js · lib/charts.js
Infrastructure     providers/{gemini,claude,openai}.js
Data               prompts/om-seeds.json · prompts/house-style.md · prompts/products/*.md
```

Every change in 02 / 03 lands inside one of these layers. If a change crosses a layer, the doc says so.

---

## What's not in the docs

- End-user / marketing material. This is an internal tool with one user; install instructions live in [../README.md](../README.md) and that's enough.
- Long arguments or alternatives — those live in [DECISIONS.md](DECISIONS.md), not in code comments or feature specs.
- Tutorial content. Comments and docs are for fellow developers, not learners.
