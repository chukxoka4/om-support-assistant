# OM Support Assistant

Chrome extension for AI-assisted drafting of OptinMonster, TrustPulse, and Beacon support tickets. Provider-agnostic: Gemini, Claude, OpenAI.

## Install (unpacked)

1. `chrome://extensions` → enable Developer mode → **Load unpacked** → select this folder.
2. Open **Options** → add at least one provider API key.
3. Open any ticket in `om.wpsiteassist.com` or select text in any Summernote editor → right-click → "OM Assistant".

## Architecture

```
Entry points       background.js · content.js · sidepanel.js · options.js
Services           lib/compose.js · lib/prompts.js · providers/index.js
Repositories       lib/storage.js · lib/html.js · lib/ticket.js
Infrastructure     providers/{gemini,claude,openai}.js
Data               prompts/om-seeds.json · prompts/house-style.md · prompts/products/*.md
```

Rules: entry points never call provider SDKs directly; they go through `providers/index.js`. DOM access lives in `lib/html.js` and `content.js`. `chrome.storage` access lives in `lib/storage.js`.

## Prompt library

The library lives in `chrome.storage.local` under `library_v3`, seeded once on
install from `prompts/om-seeds.json`. Export/import via the options page.
