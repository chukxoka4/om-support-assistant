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

## F5 — Product toggle for the WPSA prompt builder (TrustPulse / Beacon)

### Vision

The Audit tab's Build-prompt block currently hardcodes `OptinMonster` as the
product. The user supports three: OptinMonster, TrustPulse, Beacon. They want
to be able to pull WPSA reports for any of them — with the prompt and the
report header reflecting the chosen product.

### Layers and files

#### Service — [lib/prompt-generator.js](../lib/prompt-generator.js)
- `buildWpsaPrompt` takes a new `product` argument (defaults to `"OptinMonster"`
  for backwards compatibility).
- The prompt's *"Product Focus"* line and the schema body's `meta.product`
  field both reflect the chosen product.

#### Repository — [lib/storage.js](../lib/storage.js)
No change. `DEFAULT_TAXONOMY.products` already lists the three
(`OptinMonster`, `TrustPulse`, `Beacon`) — the dropdown reads from that.

#### Service — [lib/wpsa-schema.js](../lib/wpsa-schema.js)
No change. `meta.product` is already a free-text string field.

#### Entry point — [sidepanel.html](../sidepanel.html), [sidepanel.js](../sidepanel.js)
- The Build-prompt block gains a Product `<select>` next to the Scope select.
  Options: OptinMonster (default), TrustPulse, Beacon.
- Defaults to whichever product the Compose form's `#product` is currently
  set to, so users who switch context don't have to re-choose.
- Persists the last-used product per panel session (no storage change —
  in-memory state is fine).

#### Renderer — [lib/report-html.js](../lib/report-html.js), [lib/report-slack.js](../lib/report-slack.js)
- Header shows product name when it's not OptinMonster (no point cluttering
  the default case): *"Weekly Support Insights — OM · 2026-04-19 → 2026-04-25"*
  becomes *"Weekly Support Insights — TrustPulse · 2026-04-19 → 2026-04-25"*
  when product is non-default.

### Tracking

No new tracking. The chosen product is implicit in `meta.product` of the
WPSA JSON, which is already validated and stored in `draft_log` indirectly
via the digest.

### Out of scope

- Cross-product comparisons in a single digest (e.g. *"OM friction vs
  TrustPulse friction this week"*). Possible later, but separate digest
  per product is the simpler default.
- Different prompt language per product. The schema is product-agnostic;
  the AI adapts via `meta.product`.

### Effort

~30 minutes when picked up. Contained, no schema changes, no storage
migration. About 6 new tests:
- `prompt-generator` accepts `product`, defaults to OptinMonster, bakes it
  into the prompt header and `meta.product`.
- Build-prompt block defaults the product from the Compose form's value.
- Report header switches to product-prefixed when not OptinMonster.

---

## F6 — Rich-text editor for draft / prompt / manager-rewrite

### Vision

Replace the three customer-facing textareas (`#draft`, `#promptExtra`,
`.mgr-rw-text`) with a small WYSIWYG rich-text editor so formatting
round-trips cleanly to and from Summernote (the editor used in WPSA
ticket replies).

The user wants:
- Bold / italic / underline
- Bullet lists / numbered lists
- Hyperlinks
- Paragraph breaks

The user does **not** want:
- HTML tags visible anywhere — fully WYSIWYG.
- Tables, images, embedded media, custom font sizes / colours / headings —
  pruned by the sanitiser, replaced with the closest plain equivalent.

The flows that drop formatting today and need to preserve it:
- Right-click → Send to Draft / Prompt (currently `getSelection().toString()`
  → plain text)
- Generate → AI output → Insert into Summernote (currently sets `.note-editable`
  text, no HTML)
- Manager rewrite paste (currently HTML stripped to plain on paste)

### Layers and files

#### Repository (new) — `lib/html-sanitise.js`
Pure module. Tag + attribute allowlist. Strict URL scheme allowlist
(`http`, `https`, `mailto`). Used by:
- the rich editor (paste handler + getter)
- the AI output renderer (before innerHTML injection)
- the right-click capture path (before storing into
  `chrome.storage.local.incoming_selection`)
- the Insert path (before injection into Summernote)

Allowlist:
- Tags: `b`, `strong`, `i`, `em`, `u`, `a`, `p`, `br`, `ul`, `ol`, `li`,
  `s`, `strike`.
- Attributes: `href` (on `<a>`), `target`, `rel`. Nothing else.
- URL schemes: `http`, `https`, `mailto`. `javascript:`, `data:`,
  `vbscript:` rejected.
- Strips Word's `mso-*` markup and Google Docs garbage by virtue of the
  allowlist (everything outside it is unwrapped — children kept).

#### Repository / service (new) — `lib/rich-editor.js`
Wraps a `<textarea>` element, replaces it with a `<div contenteditable>`,
adds a small toolbar above it. ~150 lines, no library dependency.

Public API:
- `mountRichEditor(textareaEl, options)` → `{ getHtml, setHtml, getText, clear, focus, on }`
  - `getHtml()` returns sanitised HTML.
  - `setHtml(html)` runs through the sanitiser before insertion.
  - `getText()` plain-text fallback for the F1 lexical ranker (which scores
    on prose, not HTML soup).
  - `clear()` resets the editor.
  - `focus()` brings cursor to end.
  - `on('input', cb)` mirrors the textarea event for the suggestion-strip
    debouncer.

Toolbar buttons (only the ones with no native shortcut):
- 🔗 **Link** (insert / edit) — opens a small inline prompt for URL.
- **• List** / **1. List** — insert/toggle bullet vs numbered list.
- **Clear formatting** — escape hatch when paste-from-Word leaves ugly state.

Browser-native shortcuts kept untouched:
- Cmd+B / Cmd+I / Cmd+U for bold / italic / underline.
- Cmd+Z / Cmd+Shift+Z for undo / redo (browser-managed, not custom).

#### Entry point — [sidepanel.html](../sidepanel.html), [sidepanel.js](../sidepanel.js)
- Toolbar markup rendered above each rich-editable surface.
- CSS so the contentEditable matches the existing textarea styling exactly
  (border, padding, focus ring, min-height, resize behaviour).
- On panel init, mount rich editors for `#draft` and `#promptExtra`. The
  `.mgr-rw-text` editor is mounted when the manager-rewrite UI is created
  per draft.
- `getFormValues()` returns:
  - `draft: editor.getHtml()` — for compose
  - `draftText: editor.getText()` — for the F1 lexical ranker
  - same split for `promptExtra` if needed by any consumer.

#### Service — [lib/voice.js](../lib/voice.js)
Output contract gains a clause:

> *"You may use HTML for inline formatting in version A and version B:
> `<b>`, `<i>`, `<u>`, `<a href="...">`, `<p>`, `<br>`, `<ul>`, `<ol>`, `<li>`,
> `<s>`. No other HTML tags. No inline `style=` or `class=`. No headings."*

#### Service — [lib/compose.js](../lib/compose.js)
- `parseStructuredOutput` doesn't change — the regex captures whatever is
  between labels; HTML survives.
- `cleanPrompt` and `scenarioSummary` get **stripped to plain text** before
  the library auto-add path. They're meta-prompts, not customer-facing, and
  storing HTML in them adds noise without value.
- The PII guard runs on the stripped-plain text (current behaviour).

#### Entry point — [sidepanel.js](../sidepanel.js) `renderOutput`
Each section runs through the sanitiser, then `output-box.innerHTML = sanitised`.
Replaces the existing `plainToHtml` helper for the version sections.
Reason / metadata stay plain.

#### Entry point — Insert path
The Insert handler currently uses `chrome.scripting.executeScript` to set
`.note-editable` text. After F6:
- Sanitise the chosen rewrite once more (defence in depth).
- Inject as HTML via `document.execCommand('insertHTML', false, sanitised)`
  inside Summernote, OR set `.note-editable` innerHTML directly. Pick whichever
  Summernote behaves best with — both are documented patterns.

#### Entry point — `content.js` (right-click capture)
- Read selection HTML via `range.cloneContents()` → fragment → outerHTML of
  a wrapping `<div>`.
- Sanitise.
- Write into `chrome.storage.local.incoming_selection.text` (same key, but
  the value may now contain allowlist HTML).
- Receiver in [sidepanel.js](../sidepanel.js) calls `editor.setHtml(text)`
  rather than treating `text` as plain.

#### Data — [prompts/house-style.md](../prompts/house-style.md)
Short note added: *"Replies may include hyperlinks (`<a href="...">`),
emphasis, and lists. The extension's editor renders these as formatted
content; raw HTML is never shown to the user."*

### Storage migration

None. Existing `draft_log` records have plain-text drafts; new ones may
have HTML. Metrics, scoring, suggestion-loop, library learning don't read
`draft_input` for anything format-sensitive. The `final_used_text` and
`manager_rewrite_text` fields previously held plain text; future entries
hold sanitised HTML. Nothing breaks.

### Tracking

No new tracking. The format upgrade is invisible to the data layer.

### Tests

#### New
- `tests/unit/html-sanitise.test.js` (~15): tag allowlist, attribute
  allowlist, URL scheme rejection, malformed HTML safety, Word-paste
  normalisation, nested tags, unwrap-keep-children behaviour.
- `tests/ui/rich-editor.test.js` (~8 happy-dom): mount swaps textarea for
  contentEditable, paste handler sanitises, toolbar buttons emit expected
  HTML, getHtml / setHtml / getText round-trip, blank state clean.

#### Modified
- `tests/unit/d1-parse-fallback.test.js` — `parseStructuredOutput` preserves
  HTML inside version blocks unchanged.
- `tests/unit/compose-customer-context.test.js` — confirm HTML in
  customerContext doesn't break the pipeline.
- F1 ranker tests — confirm the lexical ranker is fed plain text via
  `getText()`, not HTML.

About **+25 new test assertions**.

### Risk register

- **contentEditable paste from Word / Google Docs** is messy. The sanitiser
  drops everything outside the allowlist, so even ugly source HTML is
  normalised. Visual result: clean text with bold/italic/lists preserved.
- **Undo / redo** is browser-native. Cmd+Z works; the stack is just less
  granular than a custom undo manager. We accept this — building our own
  undo is out of scope.
- **Cursor handling on programmatic setHtml** (right-click capture) places
  the cursor at the end of the inserted block. Acceptable; matches Summernote
  behaviour.
- **F1 suggestion strip** — it currently reads `getFormValues().draft`. Post-F6,
  it reads `.draftText` (plain). Same UX, cleaner ranker inputs.

### Order

Two commits inside F6 for review-friendliness:
1. Foundation: `lib/html-sanitise.js` + `lib/rich-editor.js` + tests.
   No UI flip yet — the modules sit unused.
2. Wire it in: replace textareas, update content script, voice prompt,
   renderOutput, Insert path.

If reviewing in one go is preferred, single commit also fine.

### Effort

About a day of focused work. 261 tests stay green; +25 new tests; total ~286.

### Out of scope

- Tables, images, embedded media in replies.
- Custom font sizes, colours, headings.
- Keyboard shortcut customisation.
- A toolbar option to "view HTML source" — deliberately omitted; the user
  said no HTML tags.

---

## F7 — Orphaned-draft finder + manual relink button

### Vision

Every once in a while a draft lands in `draft_log` without a `conversation_id` —
either from a historical bug (e.g. the multi-window `currentWindow: true`
race) or because the user composed without an OM ticket open. Today the only
way to find and relink them is a console snippet. F7 surfaces this as an
in-extension UI: list orphans with enough detail to identify each, paste a
ticket URL, click Link.

### Surfaces

A small **Orphaned drafts** card inside the existing **Library & learning**
panel, between *Recent drafts* and the suggestion review queue. Hidden when
zero orphans exist (no clutter for the common case).

```
┌─ Orphaned drafts ─────────────────────────── [3] ─┐
│ Compose drafts with no ticket link.                │
│                                                    │
│ ┌─ 2026-04-29 09:58 (40m) · OptinMonster ───────┐ │
│ │ Explain Technical Issue · VIP · Direct ·       │ │
│ │ technical · claude · delivery: copy            │ │
│ │ "Hi Alberto, Thanks for reaching out to us…"   │ │
│ │ [ Ticket URL: ___________________ ] [ Link ]   │ │
│ └────────────────────────────────────────────────┘ │
│ ┌─ 2026-04-12 16:22 (17d) · TrustPulse ──────────┐│
│ │ ...                                              ││
│ └────────────────────────────────────────────────┘│
└───────────────────────────────────────────────────┘
```

Each card shows enough to identify which orphan is which: timestamp + age,
product, dropdowns, provider, current delivery / outcome state, and a 200-
char snippet of both the rough draft input and the polished Version A.

A single inline input takes the OM ticket URL. Clicking **Link** validates
it against the `/conversation/<id>` regex, attaches `conversation_id` and
`ticket_url` to the record, and removes the card from the list. If the
draft already has a `conversation_id` (race-edited from another panel), a
status line warns and refuses to overwrite.

### Layers and files

#### Service (new) — `lib/orphan-recovery.js`
Pure module. No DOM, no Chrome APIs.
- `findOrphans(drafts)` → `[{ idx, draft }]` — compose-only, `conversation_id`
  null. Excludes quick-retone / quick-translate.
- `linkOrphanToTicket(drafts, idx, ticketUrl)` → `{ ok, error?, drafts? }`.
  Pure transform. Validates URL, guards against overwrite, returns a new
  array (or error) without touching storage. The entry point calls
  `updateDraft` (already in `lib/storage.js`) to persist.

#### Repository — [lib/storage.js](../lib/storage.js)
No new helpers. `updateDraft(id, patch)` already supports the relink.

#### Entry point — [sidepanel.html](../sidepanel.html), [sidepanel.js](../sidepanel.js)
- New section in the library panel — `<div id="orphansSection">` — rendered
  by a new `renderOrphans()` function that lives next to `renderRecentDrafts`.
- Each card shows the identifying snippets and a small inline form
  (URL input + Link button).
- The Link handler:
  1. Reads the input value.
  2. Calls `linkOrphanToTicket(allDrafts, idx, url)` (pure).
  3. If `ok`, calls `updateDraft(draftId, { conversation_id, ticket_url })`.
  4. Re-renders the orphans section.
  5. Surfaces a toast — *"Linked draft to ticket #41816"* — and re-renders
     the revisit card so the linked draft becomes actionable immediately.

### Tracking

No new tracking. The relink is just a data correction.

### Tests

- `tests/unit/orphan-recovery.test.js` (~10):
  - `findOrphans` filters compose drafts with no conversation_id.
  - Excludes quick-retone / quick-translate (no conversation_id by design).
  - Excludes drafts that already have a conversation_id.
  - `linkOrphanToTicket` validates the URL regex.
  - Refuses to overwrite an already-linked draft.
  - Returns labelled errors for missing index, malformed URL.
  - Successful path returns a new drafts array with conversation_id and
    ticket_url set on the targeted draft and no other entry mutated.
- `tests/ui/sidepanel-orphans.test.js` (~3 happy-dom):
  - Section is hidden when no orphans exist.
  - Renders one card per orphan with the expected snippet.
  - Clicking Link with a valid URL calls `updateDraft` and removes the card.

About **+13 new test assertions**.

### Out of scope

- Bulk relink (e.g. "link all my orphans to this URL"). Each draft is its
  own ticket; per-row is correct.
- Auto-suggesting a ticket for the orphan (we'd need fuzzy matching against
  ticket history — too speculative).
- Showing orphans across `quick-retone` / `quick-translate` (those have no
  ticket by design — listing them would just be noise).

### Effort

About **2 hours** including tests. Self-contained — no schema changes, no
storage migration, no new permissions.

### Order

Independent of every other F* feature. Ship whenever convenient.

---

## Order of execution

```
F1 (suggestions strip) — shipped
  ↓
F2 (Intercom client + snapshot in panel) — shipped
  ↓
F3 (outreach mode)
  ↓
F4 (synthesis)
  ↓
F5 (TrustPulse / Beacon product toggle) — small follow-up
  ↓
F6 (rich-text editor) — independently sequenceable, doesn't block F3/F4
  ↓
F7 (orphaned-draft finder + relink button) — small, independent, drop-in any time
```

F1 shipped first because the suggestions strip needs no new dependencies and
proves the new layer pattern (`lib/library-rank.js`). F2 introduced
`chrome.storage.sync` for Intercom config and the customer chip. F3 is built
on top of the F2 snapshot. F4 is plain LLM-over-data once the data is rich.
F5 is a small cosmetic add to the Audit tab and can land any time. F6 is
independent of F3 and F4 — it's a UI / formatting upgrade, not a new feature
surface — and can ship before or after either.
