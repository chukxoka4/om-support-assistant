# Conventions

How we work on this codebase. These are conventions, not laws — but breaking one without saying why is how a clean repo turns into a museum of half-applied rules. If you must deviate, leave a comment in the commit and update this doc.

---

## Branch model

Two long-lived branches:

- **`main`** — releases. Tagged when the extension is loaded into Chrome. Updated via fast-forward merge from `joseph-dev`.
- **`joseph-dev`** — the working branch. All bug fixes, all features, all docs land here first.

**No bug-fix or feature sub-branches.** Tried it once at the very start (`bug/A1-retire-v2-store`); merged into `joseph-dev`; deleted; abandoned the pattern. Single working branch is faster for a one-person project. Resurrect sub-branches only when there are multiple contributors actually paralleling.

When done with `joseph-dev` work for a release: `git checkout main && git merge --ff-only joseph-dev && git push`.

---

## Commits

### Format

```
Short one-line summary, ≤ 72 chars

Optional longer paragraph explaining the why and any context. Wrap at
72. Reference the bug or feature ID inline (A1, F6, etc.) when
applicable.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

The `Co-Authored-By` trailer goes on every commit produced in a Claude Code session. Don't strip it.

### What goes in one commit

- One logical change. A bug + the test that locks it = one commit. A feature + its tests + a docs entry = one commit.
- Don't bundle unrelated changes ("fix bug B1 + rename helper + update README").
- Doc-only commits are fine without test changes (the pre-commit hook only gates code).

### What does NOT go in commit messages

- Trial-and-error narration ("first I tried X, then Y, then…"). Just the final state.
- "WIP" — finish the work first.
- Filler ("misc cleanup"). Be specific.

---

## The pre-commit hook

[.husky/pre-commit](../.husky/pre-commit) runs:

```
npx lint-staged
npm test
```

Two gates.

### Gate 1 — `lint-staged` runs `tools/check-tests-exist.js`

Checks: if any staged file is under `lib/`, `providers/`, `mcp-intercom/`, or is a top-level entry point (`sidepanel.js`, `options.js`, `background.js`, `content*.js`), then **at least one staged file must be under `tests/`**. Otherwise the commit is blocked.

This catches the "I changed code, forgot to add tests" mistake before it lands.

### Gate 2 — `npm test`

Runs the full Vitest suite. **All tests must pass before commit.** Currently 291 tests; ~1.5 seconds end-to-end.

### Bypassing the hook

**Don't.** Specifically: never use `--no-verify` or `--no-gpg-sign` without explicit user sign-off in the same conversation, and document the bypass in the commit message. We've never had a legitimate need to bypass — the hook has caught real bugs every time we thought we wanted to.

---

## Testing rules

### Where tests live

- `tests/unit/<module>.test.js` for pure-module tests (node environment).
- `tests/integration/<flow>.test.js` for multi-module flows (e.g. compose + suggestion + library).
- `tests/ui/<surface>.test.js` for happy-dom DOM tests against side-panel / options HTML.

`vitest.config.js` picks the environment per directory.

### Helpers

- [tests/helpers/chrome-mock.js](../tests/helpers/chrome-mock.js) — fakes `chrome.storage.local`, `.sync`, `.session`, `chrome.runtime`, `chrome.tabs`, `chrome.scripting`, `chrome.windows`. Reset on each test via `beforeEach`. Includes a registry for `chrome.storage.onChanged` listeners so UI tests can fire change events programmatically via `__testFireChromeStorageLocalChange`.
- [tests/helpers/provider-mock.js](../tests/helpers/provider-mock.js) — queue-based provider response stub. Tests push expected responses or errors onto the queue.

### Patterns

- **Stub providers via `vi.mock("../../providers/index.js", ...)`** — never let tests hit real LLMs.
- **Stub `chrome.windows.getCurrent`** when testing the windowId-pinned tab queries (returns a fixed id for reproducibility).
- **Reset storage in `beforeEach`** — `await chrome.storage.local.clear()`.
- **Use `vi.useFakeTimers()`** for tests that exercise debounces (F1 strip) or auto-dismiss timers (toasts).
- **For DOM tests** that import `sidepanel.js`, mount a fixture HTML in `document.body` first, then dynamic-import the module. The module's top-level event handlers attach on import.

### When tests start to drift from reality

The tests are the spec. If a test passes but the behaviour is wrong, the test is wrong. Update the test in the same commit as the fix. Don't add a new test alongside a broken one — fix the broken one.

---

## ARCHITECTURE.md as gatekeeper

[ARCHITECTURE.md](../ARCHITECTURE.md) is the source of truth for the five-layer split (entry points / services / repositories / infrastructure / data). Every change must respect those layers.

If a change crosses a layer boundary, [docs/02-BUGS.md](02-BUGS.md) or [docs/03-FEATURES.md](03-FEATURES.md) must say so.

If you find yourself wanting to write `chrome.storage.*` outside `lib/storage.js` (or `lib/intercom-client.js` for Intercom-specific session caching), you're in violation. Stop and reshape the change.

If a violation is unavoidable, leave a one-line marker:

```js
// ARCHITECTURE VIOLATION: <one-line reason> — tracked in docs/02-BUGS.md
```

And file a bug entry to fix it later. No silent violations.

---

## Documentation discipline

### Update docs in the same commit as the code

- Shipped a bug → update its status in [docs/02-BUGS.md](02-BUGS.md) (`[x]` shipped).
- Shipped a feature → mark in [docs/03-FEATURES.md](03-FEATURES.md) (`[x]` shipped) and update [docs/01-PRODUCT.md](01-PRODUCT.md) if it changed the user-facing story.
- Made a non-obvious decision → append to [docs/DECISIONS.md](DECISIONS.md).
- Noticed something we should track but isn't a feature yet → drop it in [docs/OPEN-THREADS.md](OPEN-THREADS.md).
- Touched an integration → check [docs/INTEGRATIONS.md](INTEGRATIONS.md) is still accurate.

### What goes in code comments

- The *why*, not the *what*. The code shows what; the comment explains why this approach was picked.
- Pointers to docs when relevant: `// See docs/DECISIONS.md D9 for the conversation-counts rationale.`
- "TODO" comments are acceptable for short follow-ups; anything bigger goes in [docs/OPEN-THREADS.md](OPEN-THREADS.md).

### What does NOT go in code

- Sales / marketing / "how to install" content. That belongs outside this repo.
- Long arguments or alternatives. Those go in [DECISIONS.md](DECISIONS.md).
- Tutorial-style explanations. Comments are for fellow developers, not learners.

---

## Naming

From [ARCHITECTURE.md](../ARCHITECTURE.md), recapped:

- File names: kebab-case, no layer suffix (`compose.js`, not `compose.service.js`). The folder is the layer.
- Exports: named only. No default exports.
- Functions: verb-led (`computeMetrics`, `proposeSuggestion`, `findEquivalent`).
- Constants: `SCREAMING_SNAKE` only for true constants.
- **Forbidden module names:** `manager`, `handler`, `helper`, `util`, `utils`, `stuff`, `logic`, `core`, `common`. Be specific. *"What does it help with?"* If you can't answer, the name is wrong.

---

## Storage discipline

- All `chrome.storage.*` reads/writes go through [lib/storage.js](../lib/storage.js). Exceptions: `lib/intercom-snapshot.js` for `chrome.storage.session` caching.
- Schema changes require a deliberate migration step. New keys are fine; renaming or restructuring an existing key requires a migration that runs once at extension load.
- Don't add a new top-level `chrome.storage` key without asking whether an existing one would do. Storage keys are forever.

---

## Provider discipline

- Direct `fetch` to `api.anthropic.com` / `api.openai.com` / `generativelanguage.googleapis.com` is **forbidden** outside [providers/](../providers/).
- New provider integrations get their own file in [providers/](../providers/) and are registered in [providers/index.js](../providers/index.js).
- API keys never appear in source. They live in `chrome.storage.sync.api_keys`. Test fixtures use obviously-fake values like `sk-ant-test`.

---

## When in doubt

- Read [ARCHITECTURE.md](../ARCHITECTURE.md) and [DECISIONS.md](DECISIONS.md).
- If the answer isn't in either, ask. Better to pause than to land a quiet violation that compounds.
- The repo has a strong opinion about itself. Trust the conventions; deviate only when you have a real reason and document it.
