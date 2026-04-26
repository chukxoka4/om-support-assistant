# Feature Execution Plan

Each feature names its layer, the files it touches, and what to do. Bugs in [02-BUGS.md](02-BUGS.md) ship first.

---

## F1 — In-textarea library suggestions (5 ranked entries)

### Vision

After you type a rough draft and pause, a strip of 5 ranked library entries appears under the textarea. Each row shows title, one-line summary, score chip, and a "Use" button. Click "Use" → applies the entry's dropdowns and sets `libraryEntryId` for the next Generate.

A toggle at the top of the strip switches the ranker between **Lexical** (local, instant) and **LLM** (round trip, smarter), so you can compare them in real use and decide what to keep.

### Layers and files

#### Service (new) — `lib/library-rank.js`
Pure functions, no storage access. Takes entries as input.

- `rankLexical(draft, dropdowns, entries)` — returns `[{entry, score, reason}]` top 5.
  - Hard filter: same `product`.
  - Score: dropdown overlap (4 pts each, 16 max) + lexical overlap on `scenario_summary + scenario_title` (up to 10) + scaled `weighted_score` (0–6) + recency bonus (+2 if `last_used_at` within 14d) + concise mismatch penalty (−2).
  - Quality floor: top score must clear 8/34 to surface; otherwise return empty.
- `rankLLM(draft, dropdowns, entries, callLLM)` — returns same shape.
  - Send a single LLM call with a system prompt: "Rank these N entries by relevance to this draft + dropdowns. Return top 5 as JSON `[{id, score, reason}]`."
  - Parse JSON, map ids back to entries, return top 5.
  - On parse error or LLM error: surface error in the strip ("LLM ranker failed — switch to lexical").

#### Repository — [lib/storage.js](../lib/storage.js)
Add `getRankerMode()` / `setRankerMode()`. Stored in `chrome.storage.sync`. Default: `"lexical"`.

#### Service — [lib/compose.js](../lib/compose.js)
No change. Library binding already works via `libraryEntryId`.

#### Entry point — [sidepanel.js](../sidepanel.js)
- Debounced `input` listener on the draft textarea (~600ms after pause, only if ≥80 chars).
- Also re-fires on `change` of any of `product / goal / audience / tone / mode / concise`.
- On fire: load all library entries, call `rankLexical` or `rankLLM` per stored mode, render strip.
- Hide strip when:
  - draft has fewer than 80 chars, or
  - an entry is already picked via the dropdown, or
  - `output` panel is showing results (post-Generate).
- On "Use" click: set `libraryPick.value = id`, dispatch a `change` event on it (reuses the existing handler).
- Telemetry: log impression IDs and click IDs into a new `suggestion_log` array on the draft record at compose time.

#### HTML — [sidepanel.html](../sidepanel.html)
- New `<div id="suggestionStrip">` between the draft textarea and the Generate button.
- New `<div id="rankerToggle">` inside the strip header with two radio buttons.

### Tracking

To support later "ignored 5/5" analysis, log the suggestion IDs that were on screen at the moment of Generate, so we can compute a click-through rate per entry.

### Empty state

Strip says: "No close match — Generate will create a new entry."

---

## F2 — Intercom customer context (own MCP, in this repo)

### Vision

A small **MCP server lives inside this repo** at `mcp-intercom/`. Built fresh — `~/projects/cross-sell` is reference only.

The side panel pulls a customer health snapshot **whenever a ticket is open**, not only when you're drafting. So when you're just browsing tickets, you see the chip too.

The snapshot also feeds into the compose pipeline as extra context when you do draft.

### Architecture

The Intercom logic is shared between two callers via a single client module:

```
                ┌─────────────────────┐
                │ lib/intercom-       │  ← shared client
                │   client.js         │
                └──────────┬──────────┘
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
   ┌──────────────────┐       ┌──────────────────┐
   │ sidepanel.js     │       │ mcp-intercom/    │
   │ (extension UI)   │       │ server.js        │
   └──────────────────┘       │ (MCP for Claude  │
                              │  Desktop, etc)   │
                              └──────────────────┘
```

The extension calls the client directly (Chrome can't easily talk to MCP stdio). The MCP wraps the same client so the same tools are reusable from Claude Desktop or any other MCP client.

### Layers and files

#### Repository (new) — `lib/intercom-client.js`
Pure module, no Chrome APIs. Takes API key as constructor argument.

- `getCustomerSnapshot(email)` — returns:
  ```
  {
    found: boolean,
    plan: string | null,
    tenureDays: number | null,
    lastSeenDays: number | null,
    openConversations: number,
    conversationsLast90d: number,
    npsScore: number | null,
    tags: string[],
    recentSummaries: { id, title, summary, createdAt }[]   // last 3
  }
  ```
- `getRecentConversations(email, limit)` — raw last N conversation summaries.
- Internally caches results for 5 minutes per email in an in-memory Map.

#### MCP server (new) — `mcp-intercom/`
Files:
- `mcp-intercom/server.js` — MCP server using `@modelcontextprotocol/sdk` over stdio.
- `mcp-intercom/package.json` — node project, declares the MCP entry point.
- `mcp-intercom/.env.example` — `INTERCOM_API_KEY=...`
- `mcp-intercom/README.md` — how to register with Claude Desktop or Brave + Claude.

Tools exposed:
- `get_customer_snapshot` (input: `{email}`)
- `get_recent_conversations` (input: `{email, limit}`)
- `search_customers` (input: `{query}`) — for fuzzy lookup when you type a partial email or name.

Reads API key from env. Imports `lib/intercom-client.js` from the parent repo so the logic is shared.

#### Repository — [lib/storage.js](../lib/storage.js)
Add `getIntercomConfig()` / `setIntercomConfig()`. Stored in `chrome.storage.sync`. Fields: `apiKey`, optional `regionalEndpoint` (US default).

#### Repository — `lib/intercom-snapshot.js` (new)
Wraps `intercom-client` with extension-specific concerns:
- Reads API key from `chrome.storage.sync` via `getIntercomConfig`.
- Caches snapshots in `chrome.storage.session` for 5 minutes per email.
- Exports `loadSnapshot(email)` and `clearSnapshotCache()`.

#### Entry point — `lib/ticket.js` (extend)
Add `getCustomerEmailFromPage(tabId)` — runs `chrome.scripting.executeScript` with a selector for the customer-email element. Selector to be confirmed once the OM ticket UI is shown.

#### Service — [lib/compose.js](../lib/compose.js)
- Accept new optional `customerContext` parameter.
- In `buildUserPrompt`, include a labelled section: `"Customer context (Intercom):\n${stringifySnapshot(customerContext)}"`.
- `stringifySnapshot` lives in [lib/intercom-snapshot.js](../lib/intercom-snapshot.js) — produces a 6–10 line plain-text summary, no JSON.

#### Entry point — [sidepanel.js](../sidepanel.js)
- On panel open + ticket detected, call `getCustomerEmailFromPage`, then `loadSnapshot`. Render the health chip in a new top region.
- **Important**: triggers on ticket detection, not on Generate. Drafting state is irrelevant.
- On Generate, pass the snapshot as `customerContext` to `compose`.
- Re-fetch snapshot on tab change to a different ticket.

#### Entry point — [options.js](../options.js)
Add fields:
- "Intercom API key" (password type)
- "Test connection" button — calls `getCustomerSnapshot("test@example.com")`, surfaces the response or error in a toast.

#### HTML — [sidepanel.html](../sidepanel.html), [options.html](../options.html)
- Side panel: `<div id="customerHealth">` at the top, hidden until a snapshot loads.
- Options: API key input + Test button + small results region.

### Health chip thresholds (mockup colours)

- **Green (Healthy)**: NPS ≥ 8, OR tenure > 365d AND `conversationsLast90d` ≤ 1.
- **Yellow (At watch)**: 3–4 `conversationsLast90d`, OR `lastSeenDays > 30`, OR NPS 5–7.
- **Red (At risk)**: 5+ `conversationsLast90d`, OR `tags.includes("churn-risk")`, OR NPS ≤ 4.
- **Grey (No data)**: snapshot returned `found: false`.

VIP tag overrides others to display "🟢 VIP" with the underlying counts visible on hover.

### Privacy

Email read from the live OM page only. Snapshot lives in `chrome.storage.session` (cleared on browser close). The MCP runs locally; nothing leaves your machine except the explicit Intercom API call.

---

## F3 — Outreach mode

### Vision

A second tab in the side panel — "Outreach" — that lets you pick a customer (by email or recent ticket) and a template (renewal-30d, win-back-60d, post-resolution-checkin, cross-product-cross-sell, bug-cluster-known-issue). Generates a proactive outreach email with the customer snapshot baked in.

Saved to `draft_log` with `mode: "outreach"`.

### Layers and files

#### Data — [prompts/om-seeds.json](../prompts/om-seeds.json)
Add 5 outreach entries, each with `mode: "outreach"`:
- `Renewal — 30 days out (value recap)`
- `Win-back — cancelled in last 60 days`
- `Post-resolution check-in`
- `Cross-product cross-sell opening`
- `Bug cluster — known issue holding update`

#### Repository — [lib/storage.js](../lib/storage.js)
Extend `DEFAULT_TAXONOMY.modes` with `"outreach"`.

#### Service — [lib/voice.js](../lib/voice.js)
Extend the output contract: when `mode === "outreach"`, return one composed message + REASON only (no Version A/B). New label: `OUTREACH_MESSAGE`.

#### Service — [lib/compose.js](../lib/compose.js)
- Allow empty `draft` when `mode === "outreach"` — the customer context + template instruction are enough.
- `parseStructuredOutput` learns the `OUTREACH_MESSAGE` label.

#### Entry point — [sidepanel.js](../sidepanel.js), [sidepanel.html](../sidepanel.html)
- Tabs at the top of the panel: `Compose` | `Outreach` | `Library`.
- Outreach view: customer email selector (with autocomplete from recent ticket emails in `draft_log`), template radio group, optional notes textarea, Generate button.
- On Generate, customer snapshot is fetched (same path as F2) and fed in.

---

## F4 — Cross-ticket synthesis (deferred)

### Vision

A "Synthesis" button in the library panel runs an LLM pass over the last 30 days of `draft_log`. Returns structured JSON: top 5 recurring issues, top 3 frustrated-customer patterns, top 3 upgrade-signal patterns. Renders inline + offers JSON export for product/marketing.

### Layers and files

#### Service (new) — `lib/synthesis.js`
- `synthesizeRecent(days, drafts, callLLM)` — system prompt asking for the structured JSON shape above. Returns parsed object or error.

#### Entry point — [sidepanel.js](../sidepanel.js), [sidepanel.html](../sidepanel.html)
- Button in the library panel.
- Render area below the metrics grid.
- Export-as-JSON action.

This is deliberately last. F1 and F2 must be in production first so the data shape (`draft_log` size, customer context fields) is real.

---

## Order of execution

```
F1 (suggestions strip)
  ↓
F2 (Intercom client + MCP + snapshot in panel)
  ↓
F3 (outreach mode)
  ↓
F4 (synthesis)
```

F1 ships before F2 because the suggestions strip needs no new dependencies and proves the new layer pattern (`lib/library-rank.js`). F2 introduces the MCP folder and `chrome.storage.sync` for Intercom config. F3 is built on top of the F2 snapshot. F4 is plain LLM-over-data once the data is rich.
