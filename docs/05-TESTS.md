# Test Plan

Tests are not optional. Every bug fix and feature in [02-BUGS.md](02-BUGS.md) and [03-FEATURES.md](03-FEATURES.md) ships with the tests listed here, in the same commit. A pre-commit hook enforces this.

---

## Framework

**[Vitest](https://vitest.dev/)** — ESM-native, fast, Jest-compatible API.

- **DOM tests**: `happy-dom` environment (lighter than jsdom, sufficient for our needs).
- **Pure-module tests**: `node` environment.
- **Coverage**: `@vitest/coverage-v8`.

Why Vitest: the codebase is plain ESM with no bundler. Jest needs Babel config to handle ESM cleanly. Vitest just runs.

---

## Repo layout

```
tests/
├── unit/                  # pure module tests, node env
│   ├── compose.test.js
│   ├── library.test.js
│   ├── library-rank.test.js
│   ├── intercom-client.test.js
│   ├── intercom-snapshot.test.js
│   ├── metrics.test.js
│   ├── storage.test.js
│   ├── suggestions.test.js
│   └── voice.test.js
├── integration/           # multi-module, may stub chrome.*
│   ├── compose-pipeline.test.js
│   ├── revisit-loop.test.js
│   └── options-roundtrip.test.js
├── ui/                    # happy-dom env, sidepanel/options
│   ├── sidepanel-suggestions.test.js
│   ├── sidepanel-health-chip.test.js
│   ├── sidepanel-outreach.test.js
│   └── options-import-export.test.js
├── fixtures/              # sample drafts, library entries, intercom payloads
└── helpers/
    ├── chrome-mock.js     # chrome.storage.{local,sync,session} fake
    ├── provider-mock.js   # fake LLM responses
    └── dom-mount.js       # mount sidepanel.html into happy-dom
```

`vitest.config.js` picks env per directory:

```js
export default {
  test: {
    environmentMatchGlobs: [
      ["tests/ui/**", "happy-dom"],
      ["tests/**", "node"],
    ],
    setupFiles: ["tests/helpers/chrome-mock.js"],
  },
};
```

---

## Mocks

### Chrome APIs (`tests/helpers/chrome-mock.js`)
In-memory backing maps for `local`, `sync`, `session`. Implements `get`, `set`, `remove`, `clear`. No event emitters needed for current code.

### Providers (`tests/helpers/provider-mock.js`)
Replaces `providers/index.js` `callProvider` with a function that returns a queued response or throws a queued error. Tests push expectations onto the queue.

### Intercom (`tests/helpers/intercom-mock.js`)
Stubs `fetch` for the Intercom REST endpoints used by `intercom-client.js`. Loads canned payloads from `fixtures/intercom/`.

---

## Tests required per bug

Each row is a test file → assertion summary. All must pass before the bug PR merges.

### Phase A — Data foundation

| Bug | Test file | Asserts |
|-----|-----------|---------|
| A1 | `unit/storage.test.js` | `KEYS.library` is undefined; `getLibraryOverride` is not exported |
| A1 | `unit/prompts.test.js` | `getLibrary` is not exported from `lib/prompts.js` |
| A2 | `integration/options-roundtrip.test.js` | export → clearAll → import → `getAllEntries` matches original |
| A2 | `unit/library.test.js` | `replaceAllEntries` sets `library_v3_seeded=true`; `clearAll` wipes both keys |
| A2 | `ui/options-import-export.test.js` | Reset button restores 18 seeds |
| A3 | `ui/options-import-export.test.js` | malformed import → red toast with reason; valid → green toast with count |

### Phase B — Outcome model

| Bug | Test file | Asserts |
|-----|-----------|---------|
| B1 | `unit/metrics.test.js` | `computeMetrics` return shape has no `edited` / `rewrote` keys |
| B1 | `unit/storage.test.js` | `draftIsRevisitPending` returns false only via the three real terminal outcomes |
| B1 | `unit/compose.test.js` | new draft record has no `correction_logged` field |

### Phase C — Learning loop

| Bug | Test file | Asserts |
|-----|-----------|---------|
| C1 | `integration/revisit-loop.test.js` | saving managerial rewrite on a draft with `library_entry_id` enqueues a pending suggestion |
| C1 | `integration/revisit-loop.test.js` | a thrown `proposeSuggestion` does not break Step 2 save |
| C2 | `unit/library.test.js` | `applySuggestion` for `refine_instruction` mutates entry, marks `applied`, increments `rewrites_absorbed` |
| C2 | `unit/library.test.js` | `applySuggestion` for `split_entry` does not mutate; marks `needs_manual` |
| C2 | `ui/sidepanel-suggestions-review.test.js` | Accept opens preview; Apply commits; Cancel leaves `pending` |

### Phase D — Reliability

| Bug | Test file | Asserts |
|-----|-----------|---------|
| D1 | `unit/compose.test.js` | unlabeled output → `wasParsed:false`, raw text in `versionA` |
| D1 | `ui/sidepanel-output.test.js` | banner renders when `wasParsed:false` |
| D2 | `unit/compose.test.js` | clean prompt with email/ticket/url → not auto-added; clean → added |
| D3 | `unit/library.test.js` | `findEquivalent` returns null when instructions differ but dropdowns match |

### Phase E — Polish

| Bug | Test file | Asserts |
|-----|-----------|---------|
| E1 | `unit/compose.test.js` | `safeTitle` covers empty, short, long-unbroken, normal cases |
| E2 | `unit/providers.test.js` | each of gemini/claude/openai receives `MAX_OUTPUT_TOKENS=4096` |
| E3 | `unit/storage.test.js` | dismissal older than 7 days returns null |
| E4 | `unit/storage.test.js` | `logQuickTransform` no longer exported; quick transforms still appear via `logDraft` |

---

## Tests required per feature

### F1 — Suggestions strip

| Test file | Asserts |
|-----------|---------|
| `unit/library-rank.test.js` | `rankLexical` returns ≤5, sorted by score, only same-product entries |
| `unit/library-rank.test.js` | quality floor: top score < 8 → returns empty |
| `unit/library-rank.test.js` | dropdown overlap weighted 4 pts each, recency bonus +2 within 14d |
| `unit/library-rank.test.js` | `rankLLM` parses JSON and maps ids back; bad JSON → throws labelled error |
| `ui/sidepanel-suggestions.test.js` | strip hidden < 80 chars; appears after debounce; hides on Generate |
| `ui/sidepanel-suggestions.test.js` | "Use" click sets `libraryPick.value` and dispatches change |
| `ui/sidepanel-suggestions.test.js` | toggle Lex/LLM persists via `setRankerMode` |
| `ui/sidepanel-suggestions.test.js` | LLM error renders retry / fallback affordance |

### F2 — Intercom snapshot + MCP

| Test file | Asserts |
|-----------|---------|
| `unit/intercom-client.test.js` | `getCustomerSnapshot` shape + 5-min cache hit avoids second fetch |
| `unit/intercom-client.test.js` | `search_customers` partial match returns top N |
| `unit/intercom-snapshot.test.js` | extension wrapper reads key from `chrome.storage.sync`, caches in `session` |
| `unit/intercom-snapshot.test.js` | thresholds: green/yellow/red/grey rules and VIP override |
| `ui/sidepanel-health-chip.test.js` | chip renders on ticket detection (not requiring draft) |
| `ui/sidepanel-health-chip.test.js` | tab change to different ticket re-fetches |
| `integration/compose-pipeline.test.js` | snapshot is included in `buildUserPrompt` under "Customer context" label |
| `mcp-intercom/test/server.test.js` | each MCP tool returns expected JSON shape |

### F3 — Outreach mode

| Test file | Asserts |
|-----------|---------|
| `unit/voice.test.js` | `mode:"outreach"` emits OUTREACH_MESSAGE label, no Version A/B |
| `unit/compose.test.js` | empty draft allowed when mode outreach |
| `ui/sidepanel-outreach.test.js` | tab switch shows outreach form; Generate fires snapshot fetch |
| `unit/storage.test.js` | taxonomy modes includes `"outreach"` after seed |

### F4 — Synthesis (deferred)

Tests deferred until F4 work begins.

---

## Tests that *should* exist (regression net)

Beyond per-change tests, the suite needs a baseline of always-on regression tests so future edits can't quietly break the spine.

- **`unit/compose.test.js`**: round-trip through `buildSystemPrompt` for every `mode` value; `parseStructuredOutput` for the five real label permutations + one mislabeled fallback.
- **`unit/voice.test.js`**: house-style preamble ordering; output-contract section present for all modes; outreach contract differs.
- **`unit/library.test.js`**: `bumpScore` arithmetic for each of the four signals; `findEquivalent` for all 6 fields equal vs each one different; seed import idempotence.
- **`unit/storage.test.js`**: `logDraft` upserts on id; `getRecentDrafts` 30-day window; `addTaxonomyValue` deduplicates and trims.
- **`unit/metrics.test.js`**: `readyRate` and `managerRate` numerators/denominators; empty-log returns zeroes, not NaN.
- **`unit/providers.test.js`**: each provider's adapter passes the system prompt, user prompt, and `max_tokens` correctly; surfaces auth errors with provider name.
- **`unit/suggestions.test.js`**: `proposeSuggestion` writes a `pending_suggestions` entry with the expected shape; dedupes within a 24h window for same entry+trigger.
- **`integration/revisit-loop.test.js`**: full sequence — Generate → copy → Step 1 → manager rewrite → Step 2 → suggestion enqueued → applySuggestion → entry mutated.
- **`ui/sidepanel-output.test.js`**: copy/insert buttons fire correct events; insert path posts to active tab.

---

## Pre-commit hook

We use [Husky](https://typicode.github.io/husky/) + [lint-staged](https://github.com/lint-staged/lint-staged). Both are dev-only.

`package.json`:
```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "prepare": "husky"
  },
  "lint-staged": {
    "lib/**/*.js": ["node tools/check-tests-exist.js"],
    "providers/**/*.js": ["node tools/check-tests-exist.js"],
    "*.js": []
  }
}
```

`.husky/pre-commit`:
```
npx lint-staged
npm run test
```

`tools/check-tests-exist.js` — fails if any staged file under `lib/`, `providers/`, `mcp-intercom/`, or top-level entry points (`sidepanel.js`, `options.js`, `background.js`) is changed without a corresponding change under `tests/`. The diff is staged-only; it does not block edits to docs or fixtures.

Result: every commit that touches code either updates or adds tests, and the full suite must be green before the commit lands. No `--no-verify` in scripts; if you bypass it, that's a conscious human choice.

---

## CI parity

GitHub Actions (or whatever runner we land on) runs the same `npm run test` on PRs. The hook is a fast local check; CI is the source of truth. Coverage threshold to be set after the first green run on `main` — start at the actual number, ratchet up.

---

## Order

Tests land alongside their feature/bug. Suggested infra setup order **before A1**:

1. `npm init`, install Vitest + happy-dom + Husky + lint-staged.
2. Drop in `vitest.config.js`, `tests/helpers/chrome-mock.js`, `tests/helpers/provider-mock.js`.
3. Write `unit/storage.test.js` against the *current* code so we have a baseline that A1 must keep green.
4. Install Husky hook.
5. Then start Phase A.

This way the hook is in place the moment A1's PR opens, and we never have a "we'll add tests later" window.
