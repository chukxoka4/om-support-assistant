# OM Support Assistant — Plan Index

Living planning docs. Read in order.

1. **[01-PRODUCT.md](01-PRODUCT.md)** — what the product is today, what's half-built, what's coming.
2. **[02-BUGS.md](02-BUGS.md)** — known bugs and the order to fix them. Each fix names the files to touch.
3. **[03-FEATURES.md](03-FEATURES.md)** — new features. Each feature names the layer, files, and what to do.
4. **[04-MOCKUPS.md](04-MOCKUPS.md)** — text mockups for visual review before any UI is built.
5. **[05-TESTS.md](05-TESTS.md)** — test plan, framework choice, commit hooks.

## Rules of the road

- No file gets a feature change without a test added in the same commit.
- Every test must pass before commit (pre-commit hook enforces this).
- Bugs and features get their own branch. Branch name = section id (e.g. `bug/A1-retire-v2-store`, `feat/F1-suggestions-strip`).
- Mockups get human review before any UI code is written.
- Plans are living: when reality changes, the doc changes in the same commit as the code.

## Architecture layers (from [README.md](../README.md))

```
Entry points       background.js · content scripts · sidepanel.js · options.js
Services           lib/compose.js · lib/prompts.js · providers/index.js
Repositories       lib/storage.js · lib/html.js · lib/ticket.js
Infrastructure     providers/{gemini,claude,openai}.js
Data               prompts/library.json · prompts/house-style.md · prompts/products/*.md
```

Every change in 02 and 03 lands inside one of these layers. If a change crosses a layer, the doc says so.
