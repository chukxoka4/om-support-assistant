# Architecture — OM Support Assistant

**Read this before writing or modifying any code.** It describes how *this* codebase is organised, not architecture in the abstract. If a change you're about to make doesn't fit, stop and reshape the change — don't bend the architecture.

This document is the source of truth. README.md, [docs/00-INDEX.md](docs/00-INDEX.md), [docs/02-BUGS.md](docs/02-BUGS.md), and [docs/03-FEATURES.md](docs/03-FEATURES.md) all defer to it.

---

## Stack

- **Runtime**: Chrome Manifest V3 extension. No build step. No bundler. No TypeScript.
- **Language**: Plain ES modules (`type: "module"` in [manifest.json](manifest.json) for the service worker; ESM `<script type="module">` in HTML).
- **Tests**: Vitest + happy-dom. `npm test` is the only test command. Husky pre-commit gates code commits behind passing tests + a tests-touched check ([tools/check-tests-exist.js](tools/check-tests-exist.js)).
- **No framework**: no React, no Vue, no bundler. DOM is hand-rolled. State is `chrome.storage`.

What that means for new code:
- ES modules only. No CommonJS, no `require`, no `__dirname`.
- No transpilers. If a syntax doesn't run in current Chrome, don't use it.
- No new runtime dependencies without explicit user sign-off — every new package weighs the bundle and the trust surface.

---

## The five layers

This codebase has five layers, in this dependency direction (top calls down, never up):

```
┌────────────────────────────────────────────────────────────────────┐
│ 1. Entry points    background.js · sidepanel.js · options.js       │
│                    content.js · content-ticket.js                  │
│                    content-overlay.js                              │
│                    (+ sidepanel.html, options.html)                │
├────────────────────────────────────────────────────────────────────┤
│ 2. Services        lib/compose.js · lib/voice.js                   │
│                    lib/library.js · lib/library-rank.js (planned)  │
│                    lib/suggestions.js · lib/metrics.js             │
│                    lib/quick-transform.js · lib/prompts.js         │
│                    lib/intercom-snapshot.js (planned)              │
│                    providers/index.js                              │
├────────────────────────────────────────────────────────────────────┤
│ 3. Repositories    lib/storage.js · lib/html.js · lib/ticket.js    │
│                    lib/intercom-client.js (planned)                │
├────────────────────────────────────────────────────────────────────┤
│ 4. Infrastructure  providers/gemini.js · providers/claude.js       │
│                    providers/openai.js                             │
│                    mcp-intercom/server.js (planned)                │
├────────────────────────────────────────────────────────────────────┤
│ 5. Data            prompts/om-seeds.json · prompts/house-style.md  │
│                    prompts/products/*.md                           │
└────────────────────────────────────────────────────────────────────┘
```

Each layer has rules. Treat them as hard constraints.

### Layer 1 — Entry points

The only files Chrome loads directly: the service worker, the content scripts, the side panel page, the options page.

**Allowed**:
- Wire DOM events to service calls.
- Read user input, render service output.
- Use `chrome.runtime`, `chrome.tabs`, `chrome.contextMenus`, `chrome.scripting`, `chrome.notifications`, `chrome.sidePanel` APIs (these are inherently entry-point concerns).
- Import from layers 2 and 3.

**Forbidden**:
- Direct `fetch()` to provider APIs. Always go through [providers/index.js](providers/index.js).
- Direct `chrome.storage.*` reads/writes. Always go through [lib/storage.js](lib/storage.js).
- Inline business logic. If a function is more than orchestration, it belongs in `lib/`.
- Importing `providers/{gemini,claude,openai}.js` directly. The dispatcher is the only public surface.

**Size budget**: a single entry-point handler should fit in ~30 lines. The whole file may be larger because there are many handlers, but each one is thin: parse, delegate, render. [sidepanel.js](sidepanel.js) is currently ~35 KB — that is the ceiling, not the target. New work should pull logic *out* of it, never push more in.

### Layer 2 — Services

Pure business logic. Compose the system prompt, parse model output, rank library entries, compute metrics, propose suggestions, run quick transforms.

**Allowed**:
- Import from layers 3, 4 (via 2's own conventions), and pure helpers within layer 2.
- Receive primitives (or repository data) as arguments and return primitives or domain objects.
- Throw domain errors. Let entry points translate them to UI.

**Forbidden**:
- Touching `chrome.storage.*`, `document`, `window`, `fetch` directly. Use a repository.
- Importing entry points.
- Knowing about the DOM. A service that returns HTML strings is a smell.

**Service shape**: prefer pure functions exported from a module. A service file groups functions by concern, not by class. No `Manager`, `Handler`, `Helper`, `Util` suffixes — name modules after what they *do* (`compose`, `voice`, `library-rank`).

**Size budget**: 200 lines soft, 300 hard. If a service exceeds 300 lines, extract a sub-service before adding more.

### Layer 3 — Repositories

The only place that talks to storage, the DOM, the active tab, or external HTTP APIs (Intercom).

| Module | Owns |
|---|---|
| [lib/storage.js](lib/storage.js) | every `chrome.storage.local`, `.sync`, `.session` read and write. Defines `KEYS`. |
| [lib/html.js](lib/html.js) | DOM extraction from the content script's view. |
| [lib/ticket.js](lib/ticket.js) | OM ticket page introspection (URL parsing, customer email selector, etc). |
| `lib/intercom-client.js` *(planned, F2)* | Intercom REST calls. Shared between extension and the in-repo MCP. |

**Allowed**:
- `chrome.storage.*`, `fetch`, `document.querySelector`, `chrome.scripting.executeScript`.
- Import infrastructure (e.g. an MCP transport) only if needed.

**Forbidden**:
- Business decisions. A repository returns data; it does not interpret it. "Is this draft pending revisit?" lives in a service, not in storage.js.
- Importing services. Repositories are leaves.
- Cross-repository imports. If `intercom-snapshot.js` (service) needs both storage and the Intercom client, it composes them — the repositories don't know about each other.

**Size budget**: 150 lines soft, 250 hard. Split by entity (`storage-drafts.js`, `storage-library.js`) before going over.

### Layer 4 — Infrastructure

Provider SDK wrappers. One file per provider, each exposing `callProvider({ system, user, maxTokens, ... }) → string`. The dispatcher in [providers/index.js](providers/index.js) is the only thing in layer 2 that imports them.

The Intercom MCP server at `mcp-intercom/server.js` (planned) is also infrastructure: it's a transport wrapper around `lib/intercom-client.js`.

**Allowed**:
- Provider-specific HTTP shape, auth headers, error mapping.
- Constants like `MAX_OUTPUT_TOKENS` (planned, bug E2) live in the dispatcher and are passed down.

**Forbidden**:
- Knowing about drafts, library entries, or any of our domain objects. A provider takes strings and returns a string.

### Layer 5 — Data

Static JSON and Markdown shipped with the extension. Loaded via `chrome.runtime.getURL` + `fetch`. Listed in `web_accessible_resources` in [manifest.json](manifest.json).

When deleting a data file ([prompts/library.json](prompts/library.json) per bug A1), also remove it from `web_accessible_resources` and from any code that fetches it.

---

## Cross-feature rules

This codebase does not yet use a `features/` folder. The current shape is layer-first, not feature-first, and that is fine for this size. **Do not introduce a feature folder structure without a discussion** — it would scatter the layer split.

When a new feature is added (e.g. F1 suggestions strip), its files slot into the existing layers:

- F1 service: [lib/library-rank.js](lib/library-rank.js)
- F1 storage helpers: extend [lib/storage.js](lib/storage.js) (`getRankerMode`/`setRankerMode`)
- F1 entry-point glue: extend [sidepanel.js](sidepanel.js) and [sidepanel.html](sidepanel.html)
- F1 tests: `tests/unit/library-rank.test.js`, `tests/ui/sidepanel-suggestions.test.js`

If a feature needs more than ~3 service files, that's the moment to ask whether a sub-folder under `lib/` makes sense (e.g. `lib/intercom/`).

---

## Naming

- File names: kebab-case, no suffixes for layer (`compose.js`, not `compose.service.js`). The folder *is* the layer.
- Exports: named only. No default exports — they're harder to grep.
- Functions: verb-led (`computeMetrics`, `proposeSuggestion`, `findEquivalent`).
- Constants: `SCREAMING_SNAKE` only for true constants (`KEYS`, `TERMINAL_OUTCOMES`, `MAX_OUTPUT_TOKENS`).
- Forbidden module names: `manager`, `handler`, `helper`, `util`, `utils`, `stuff`, `logic`, `core`, `common`. Be specific.

---

## Testing requirements

Every layer-2/3/4 file has a matching test under `tests/`:

- `tests/unit/<module>.test.js` for pure modules.
- `tests/integration/<flow>.test.js` for multi-module flows (e.g. revisit loop).
- `tests/ui/<surface>.test.js` for happy-dom tests against `sidepanel.html` / `options.html`.

Helpers ([tests/helpers/chrome-mock.js](tests/helpers/chrome-mock.js), [tests/helpers/provider-mock.js](tests/helpers/provider-mock.js)) stand in for `chrome.*` and the provider dispatcher. Use them. Do not import real `chrome.*` in tests, and do not hit real LLMs.

The pre-commit hook will block code commits that touch `lib/`, `providers/`, `mcp-intercom/`, or any top-level entry-point file without also touching `tests/`. That gate is intentional. Do not bypass it with `--no-verify` unless the user has explicitly approved that specific commit.

Full plan: [docs/05-TESTS.md](docs/05-TESTS.md).

---

## Pre-code checklist (use this every time)

Before writing or editing code, run through these. If any answer is "no", stop and reshape the change.

```
[ ] I know which layer this code belongs in.
[ ] If it's storage/DOM/HTTP, it's in a repository (layer 3), not a service or entry point.
[ ] If it's business logic, it's in a service (layer 2), not in sidepanel.js / options.js / background.js.
[ ] If it's a provider call, it goes through providers/index.js — not direct to the SDK.
[ ] No service imports an entry point. No repository imports a service.
[ ] Naming follows the conventions (no Manager/Handler/Helper/Util).
[ ] If editing a file, the change won't push it over the layer's hard size limit.
[ ] If adding a new file, no existing file already owns this responsibility.
[ ] A test exists or will be added in the same commit (the hook will check).
[ ] If the change crosses a layer boundary, docs/02-BUGS.md or docs/03-FEATURES.md says so.
```

---

## Layer-violation responses

If a planned change would violate the architecture:

1. Stop. Don't write it.
2. State the violation in plain language ("this would put a `fetch` to Anthropic inside sidepanel.js, which bypasses the provider dispatcher").
3. Propose the compliant version ("add it to providers/index.js, expose a function, call that from sidepanel.js").
4. Only if the user explicitly accepts the violation, write the code with a single-line marker comment:
   ```js
   // ARCHITECTURE VIOLATION: <one-line reason> — tracked in docs/02-BUGS.md
   ```
   And open a follow-up entry in [docs/02-BUGS.md](docs/02-BUGS.md). No silent violations.

---

## Specific known constraints

A few rules that come from this codebase's quirks rather than general architecture:

- **MV3 service worker is non-persistent.** [background.js](background.js) cannot hold module-level state across idle. Persist anything important via [lib/storage.js](lib/storage.js).
- **No DOM in the service worker.** No `document`, no `window`. Use `chrome.scripting.executeScript` if you need to read the page.
- **Content scripts run in an isolated world.** They can read the page DOM but not its JS variables. SPA navigation needs `pushState` / `replaceState` hooks; see [content-ticket.js](content-ticket.js).
- **Side panel and options run in the extension origin.** They can `import` ESM freely from the extension folder; they cannot reach the page's DOM directly.
- **MCP server (`mcp-intercom/`, planned) imports `lib/intercom-client.js` from the parent repo.** That sharing is intentional. Don't fork the logic. If it diverges, fix the shared module.
- **No new runtime dependencies in the extension itself.** Test-time dev dependencies are fine. Anything in `manifest.json`-served code stays vanilla.

---

## When this document changes

Architecture changes in the same commit as the code that motivates them. If you're tempted to "just this once" cross a layer, edit this file first to legitimise it — and if you can't write that edit with a straight face, the change doesn't belong.
