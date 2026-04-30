# OM Support Assistant

Chrome MV3 extension for AI-assisted **drafting and reviewing** of support replies on OptinMonster, TrustPulse, and Beacon tickets. Provider-agnostic — Gemini, Claude, OpenAI. One agent, one tool, deep integration.

> **New here?** Read [docs/CONTEXT-MAP.md](docs/CONTEXT-MAP.md) before any other doc. It explains what this is, who it's for, and which doc to read for which task.

## Install (unpacked)

1. `chrome://extensions` → enable Developer mode → **Load unpacked** → select this folder.
2. Open **Options** → add at least one provider API key. Optional: paste an Intercom API key (US workspace) for the customer chip; set "Your name (for reports)" for the weekly digest.
3. Open any ticket on `om.wpsiteassist.com/conversation/...` → the side panel becomes the workbench. Or: select text on any page → right-click → **OM Assistant** for quick retones / translations.

## Architecture

```
Entry points       background.js · content.js · content-overlay.js · content-ticket.js
                   sidepanel.js · options.js
Services           lib/compose.js · lib/voice.js · lib/library.js · lib/library-rank.js
                   lib/suggestions.js · lib/intercom-snapshot.js · lib/audit-metrics.js
                   lib/prompt-generator.js · lib/quick-transform.js · lib/report-html.js
                   providers/index.js
Repositories       lib/storage.js · lib/intercom-client.js · lib/ticket.js · lib/html.js
                   lib/toast.js · lib/wpsa-schema.js · lib/paginate.js · lib/charts.js
Infrastructure     providers/{gemini,claude,openai}.js
Data               prompts/om-seeds.json · prompts/house-style.md · prompts/products/*.md
```

Rules in three lines:
- Entry points never call provider SDKs directly; they go through `providers/index.js`.
- DOM access lives in `lib/html.js` and content scripts.
- `chrome.storage` access lives in `lib/storage.js` (and `lib/intercom-snapshot.js` for session-scoped Intercom caching).

Full spec in [ARCHITECTURE.md](ARCHITECTURE.md).

## What it does

Three surfaces:

- **Side panel** — main workbench. Compose review (paste rough draft + context → AI returns two rewrites + a reason). Customer-health chip from Intercom on every ticket. In-textarea library suggestions (top 5 ranked entries before you Generate). Two-step revisit loop (Step 1: what went forward, Step 2: outcome). Library / Playbook with auto-grow + learn-from-managerial-rewrite. Weekly Audit & Report tab that emits a self-contained HTML digest + Slack snippet for Friday reporting.
- **Ticket page modal** — when you reopen a ticket with an unresolved draft, a native browser dialog reminds you to finish Step 1 / Step 2.
- **Right-click overlay** — quick retones (fix grammar, friendlier, shorter, etc.) and translations to 22 languages on any selected text.

## Prompt library

Lives in `chrome.storage.local` under `library_v3`. Seeded once on install from [prompts/om-seeds.json](prompts/om-seeds.json) (18 OM scenarios). Auto-grows on every compose without a preset. Manager rewrites enqueue LLM-proposed refinements; the agent reviews and applies (no auto-apply, ever — see [docs/DECISIONS.md D2](docs/DECISIONS.md#d2)).

Export / Import / Reset wired in both the Options page and the side-panel Settings. Imports require an explicit Merge or Replace confirmation step — never destructive by default.

## Tests and conventions

- Vitest + happy-dom. ~290 tests, ~1.5 second suite.
- Husky pre-commit hook gates code commits behind tests-touching + suite-passing.
- Single working branch: `joseph-dev`. Merge to `main` for releases.
- Full norms in [docs/CONVENTIONS.md](docs/CONVENTIONS.md).

```bash
npm install   # one-time
npm test      # run the suite
```

## Documentation

Living docs in [docs/](docs/). Start with [docs/CONTEXT-MAP.md](docs/CONTEXT-MAP.md), then drill into whatever you need — [docs/00-INDEX.md](docs/00-INDEX.md) lists everything with a one-line description.
