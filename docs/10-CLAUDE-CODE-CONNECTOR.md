# 10 — Claude Code Connector (Enterprise-seat LLM routing)

**Status: Slices 0–1 DONE (2026-07-10).** Decisions ratified (DEC-A…E → D34–D38);
the native-messaging bridge is built, tested, and verified live on the Enterprise
seat. **Next: Slice 2** (layer-4 provider + dispatcher + manifest). Slices 3–7
remain. This document is the execution plan.
It is written so a fresh session (fresh agent, no prior context) can pick up any
slice and execute it correctly. Read [../ARCHITECTURE.md](../ARCHITECTURE.md)
first — every slice below must pass its pre-code checklist. Also read
[CONVENTIONS.md](CONVENTIONS.md) for the commit/test/hook contract.

---

## 1. Why this exists (the pend)

LLM-assisted features were **pended** because they send customer ticket text to
third-party LLM APIs (Gemini / OpenAI / direct Anthropic API) authenticated
with personal API keys. That's a data-governance problem: customer data leaving
under personal, non-enterprise terms.

**The fix:** add a fourth provider, `claude-code`, that carries **no API key**.
The extension hands `{ system, user, model }` to a small local bridge (a Chrome
*native messaging host*), and the bridge runs the call through the locally
installed **Claude Code CLI**, which is authenticated with the agent's
**Claude Enterprise seat** (claude.ai OAuth). Customer data then goes only to
Anthropic, under Awesome Motive's Enterprise agreement.

**Constraints set by the owner (Nwachukwu):**
1. Stay LLM-agnostic — the provider abstraction survives; Gemini/OpenAI remain
   selectable.
2. The Claude Code connector becomes the **default** for every LLM call.
3. No feature regressions — especially the reporting pipeline.

**Verified facts about auth/mechanics** (checked against
code.claude.com docs on 2026-07-10, via the claude-code-guide agent):
- Headless one-shot: `claude -p --output-format json --system-prompt "…"
  --model <id> --max-turns 1` — reads the Enterprise-seat OAuth login
  automatically when `ANTHROPIC_API_KEY` is unset.
- JSON result shape: `{ "result": "<final text>", "session_id", "total_cost_usd",
  "usage": { input_tokens, output_tokens, ... } }`.
- Tool restriction: **UPDATED at implementation (Slice 1, CLI v2.1.49,
  2026-07-10).** `--max-turns` **does not exist** in this CLI version. The
  installed CLI has `--tools "<list>"` — `--tools ""` disables ALL built-in
  tools, which gives a single-turn pure transform without needing `--max-turns`.
  So transform mode uses `--tools ""`; reason mode uses `--tools "Read,Grep,Glob"`
  (only those three tools exist → Write/Edit/Bash structurally absent, DEC-G).
  Re-verify against `claude --help` on every version bump — do not trust this
  doc over the installed CLI.
- Alternative: `@anthropic-ai/claude-agent-sdk` `query()` also reuses the CLI
  login. **Not chosen** for v1 — it's an npm runtime dependency; the CLI-spawn
  bridge is zero-dependency (Node builtins only). Revisit if per-call CLI
  spawn latency proves unacceptable (see §6 Latency).

---

## 2. Verified current state (audited 2026-07-10 — re-verify before each slice)

### 2.1 The complete LLM call surface

All LLM traffic goes through **one dispatcher**: `callLLM()` in
[providers/index.js](../providers/index.js) (layer 2). It resolves the
provider (`provider` arg → `getDefaultProvider()` → first of
`getAvailableProviders()`), looks up an API key from
[lib/storage.js](../lib/storage.js) `getApiKeys()`, and dispatches to layer 4.

Layer-4 providers (each `fetch`es directly, needs `apiKey`):
- [providers/gemini.js](../providers/gemini.js)
- [providers/claude.js](../providers/claude.js) — direct `api.anthropic.com`,
  `x-api-key` + `anthropic-dangerous-direct-browser-access`, default model
  `claude-sonnet-4-6`
- [providers/openai.js](../providers/openai.js)

Callers of `callLLM` (this list is **exhaustive** as of the audit; re-grep
`callLLM` before relying on it):

| Caller | What it sends to the LLM | Provider arg? | Failure mode |
|---|---|---|---|
| [lib/compose.js](../lib/compose.js) `:99` | Full draft-generation prompt: ticket text, customer context, library entries | yes (`provider` from UI) | returns `{ error }` — user sees it |
| [lib/quick-transform.js](../lib/quick-transform.js) `retone()` `:62`, `translate()` `:70` | The draft HTML being transformed | yes | returns `{ error }` |
| [lib/suggestions.js](../lib/suggestions.js) `proposeSuggestion()` `:37` | AI draft vs human-corrected final (library refinement) | **no** — always default provider | returns `{ error }`, logged |
| [lib/text-polish.js](../lib/text-polish.js) `polishText()` / `polishBullets()` | Weekly report "ask" text + hypothesis bullets | **no** — always default provider | **silent fallback to original** after `DEFAULT_TIMEOUT_MS = 5000` (see D32) |
| [lib/library-rank.js](../lib/library-rank.js) `rankLLM()` `:151` | Draft + top-30 library shortlist | injected — [sidepanel.js](../sidepanel.js) `:28` passes `providerCallLLM` | throws; strip shows error |

Entry-point involvement: sidepanel.js imports `callLLM` **only** to inject
into `rankLLM` (allowed); options.js manages keys + default provider;
background.js currently makes **no** LLM calls.

### 2.2 Reporting pipeline — what actually touches an LLM

The weekly report flow ([sidepanel.js](../sidepanel.js) report tab):
- `computeAuditMetrics[ForRange]` ([lib/audit-metrics.js](../lib/audit-metrics.js)) — **local, no LLM**
- WPSA prompt generation ([lib/prompt-generator.js](../lib/prompt-generator.js)) — **local, no LLM** (the generated prompt is pasted into WPSA AI by the agent, outside this extension)
- **`polishText(ask)`** — sidepanel.js `~:1288`, before report render — **LLM call**
- **`polishBullets(hypotheses)`** — sidepanel.js `~:1154`, on "Generate prompt" — **LLM call**
- Report render ([lib/report-html.js](../lib/report-html.js)) — local
- Slack delivery ([lib/report-slack.js](../lib/report-slack.js)) — **external HTTP but NOT an LLM. Out of scope. Do not migrate.**

So: routing the dispatcher to `claude-code` automatically covers the report
pipeline. The one report-specific risk is the **5-second polish timeout**
(§6).

### 2.3 Other external calls that are explicitly OUT of scope

- [lib/intercom-client.js](../lib/intercom-client.js) — Intercom REST (data
  source, not an LLM). Unchanged.
- [lib/report-slack.js](../lib/report-slack.js) — Slack webhook delivery.
  Unchanged.

### 2.4 Where the "pend" actually lives

There is no single `pended` flag. The pend is operational: LLM-dependent
features degrade gracefully when no provider/key is configured —
`text-polish` silently passes originals through (DECISIONS.md D32), ranker
defaults to Lex (D6/D7), compose/suggestions surface "No provider configured".
**Un-pending = making `claude-code` the working default provider.** No
feature flags need flipping. Do **not** change the Lex-default ranker decision
(D6/D7) as part of this work.

### 2.5 Storage & options today

- `getApiKeys()` → `{ gemini, claude, openai }` in `chrome.storage.sync`
- `getAvailableProviders()` → providers **with a non-empty key** — this
  definition must change (claude-code is key-less)
- `getDefaultProvider()` / `setDefaultProvider()` → `sync`
- [options.js](../options.js) (251 lines) renders key fields + default-provider
  select; [manifest.json](../manifest.json) has **no** `nativeMessaging`
  permission yet.

---

## 3. Target architecture

```
lib/* services ── callLLM({provider?, model?, system, user})
      │
      ▼
providers/index.js  (layer 2 dispatcher — key lookup becomes provider-aware:
      │              key-less providers skip the apiKey check)
      ├── providers/gemini.js      (layer 4, unchanged, keyed, opt-in gated)
      ├── providers/claude.js      (layer 4, unchanged, keyed — direct API stays
      │                             as the no-bridge fallback)
      ├── providers/openai.js      (layer 4, unchanged, keyed, opt-in gated)
      └── providers/claude-code.js (layer 4, NEW, key-less)
              │  chrome.runtime.sendNativeMessage("com.optinmonster.claude_bridge", …)
              ▼
      bridge/claude-bridge.js      (NEW top-level folder, OUTSIDE the extension
              │                     bundle — a Node script registered as a Chrome
              │                     native-messaging host; zero npm dependencies)
              ▼
      spawn: claude -p --output-format json …   (auth = Enterprise seat OAuth)
              ▼
      Anthropic only.
```

Layer placement (per ARCHITECTURE.md):
- `providers/claude-code.js` is **layer 4 infrastructure** — same contract as
  its siblings: takes strings, returns `{ text }` or `{ text: "", error }`,
  knows nothing about domain objects. Its "transport" is native messaging
  instead of `fetch`; that is the same category of concern as an HTTP shape.
- `bridge/` is infrastructure **outside the extension**, like the planned
  `mcp-intercom/`. It is not served by manifest.json, so the "no new runtime
  dependencies in the extension" rule is honoured (and the bridge itself uses
  only Node builtins anyway).
- ARCHITECTURE.md's layer table must be updated **in the same commit** that
  creates these files (its own rule: "Architecture changes in the same commit
  as the code that motivates them").

**Transport note (verify at implementation, don't assume):**
`chrome.runtime.sendNativeMessage` requires the `nativeMessaging` permission
and is callable from extension pages (side panel, options) and the service
worker — which covers every current `callLLM` caller, so **no background.js
relay should be needed**. Slice 2 includes a smoke test to confirm this from
the side panel; if it fails in practice, the documented contingency is a thin
relay in background.js (`llm_bridge_call` message → `sendNativeMessage`),
which keeps the provider file unchanged except for the transport line.

---

## 4. Decisions to ratify (flag these to the user in Slice 0 — do NOT silently assume)

DEC-A…E were proposed in the design conversation (2026-07-10 session) and
**RATIFIED as-written by the owner on 2026-07-10 (Slice 0)** — recorded in
[DECISIONS.md](DECISIONS.md) as D34–D38 respectively. Each slice that depends on
one still verifies the DECISIONS.md entry before relying on it.

- **DEC-A — Default provider (RATIFIED 2026-07-10 → D34).** When the bridge is
  enabled, `claude-code` is the default for *every* dispatcher call. Explicit
  `provider` args from the UI still win (agnosticism preserved).
- **DEC-B — Third-party gating (RATIFIED 2026-07-10 → D35).** Gemini and OpenAI
  key fields (and their selectability) move behind an explicit "Third-party
  providers" opt-in toggle in options, with a one-line data warning. Direct-API
  Claude ([providers/claude.js](../providers/claude.js)) stays un-gated — same
  destination (Anthropic), different auth.
- **DEC-C — Bridge shape (RATIFIED 2026-07-10 → D36).** Zero-dependency Node
  script spawning `claude -p` per call (not the Agent SDK, not a localhost HTTP
  server). Host manifest `allowed_origins` locked to this extension's ID.
- **DEC-D — Polish timeout (RATIFIED 2026-07-10 → D37).** `polishText`/
  `polishBullets` get a provider-aware timeout: keep 5000 ms for HTTP providers,
  use `CLAUDE_CODE_TIMEOUT_MS` (30000) when the resolved default is
  `claude-code`. D32's "best-effort, never fails the flow" contract is
  preserved — only the budget changes.
- **DEC-E — Availability semantics (RATIFIED 2026-07-10 → D38).** `claude-code`
  counts as "available" when a stored status flag says the last bridge ping
  succeeded (set by options "Test connection"), not when a key exists.
- **DEC-F — KB reasoning layer (RATIFIED 2026-07-10).** The bridge supports two
  call modes. `transform`: stateless, **no tools**, `--max-turns 1` (polish,
  retone/translate, suggestions, ranker). `reason`: agentic — working
  directory = the local support-desk knowledge base, tools locked to the
  read-only set `Read, Grep, Glob`, multi-turn — used by draft composition
  (`lib/compose.js`) so the model searches patterns/drafts as part of its
  thinking. See Slice 6.
- **DEC-G — KB is strictly read-only; no PII to git (RATIFIED 2026-07-10).**
  The extension never writes to support-desk. No kb-append, no draft
  write-back, no managerial-rewrite export (rewrites live in chrome.storage
  and reach the model via the compose prompt, as today). The guarantee is
  structural: reason mode's tool allowlist excludes `Write`, `Edit`, and
  `Bash`, so ticket text physically cannot land on disk or in git. Ticket
  text flowing to Anthropic for inference is accepted (Claude Enterprise is
  the processor). The symlink alternative was considered and rejected
  (read-only anyway, second mechanism, dies when packaged).

---

## 5. Slices

Rules for every slice (from CONVENTIONS.md + ARCHITECTURE.md — non-negotiable):
- Branch off `joseph-dev` (confirm current branch model in CONVENTIONS.md first).
- The pre-commit hook **blocks** commits touching `lib/`, `providers/`, or
  entry-point files without touching `tests/`. Write tests in the same commit.
- Tests use [tests/helpers/chrome-mock.js](../tests/helpers/chrome-mock.js) and
  [tests/helpers/provider-mock.js](../tests/helpers/provider-mock.js) — never
  real `chrome.*`, never real LLMs.
- ES modules, named exports, kebab-case filenames, no
  manager/handler/helper/util names.
- Each slice ends with `npm test` green and the listed doc updates in the same
  commit.

---

### Slice 0 — Ratify decisions + record the plan (no code) — ✅ DONE 2026-07-10

**Goal:** decisions DEC-A…E confirmed with the user and recorded; this doc
committed.

1. ✅ Presented DEC-A…E to the owner; all confirmed **as-written** (no
   adjustments). Owner directive: stay on `joseph-dev`, no branching.
2. ✅ Added to [DECISIONS.md](DECISIONS.md) as D34 (DEC-A), D35 (DEC-B),
   D36 (DEC-C), D37 (DEC-D), D38 (DEC-E) — house format.
3. ✅ Listed this doc in [00-INDEX.md](00-INDEX.md); added the session row to
   [SESSION-HISTORY.md](SESSION-HISTORY.md).

**Acceptance:** docs committed; user has explicitly confirmed each decision. ✅

---

### Slice 1 — The bridge (outside the extension) — ✅ DONE 2026-07-10

**Delivered:** `bridge/{claude-bridge.js, frame-codec.js, build-args.js,
frame-call.js, install.sh, README.md, config.template.json,
host-manifest.template.json}` + `bridge/config.json` (gitignored). Tests:
`tests/unit/frame-codec.test.js`, `tests/unit/bridge-build-args.test.js`.
ARCHITECTURE.md layer-4 table updated. Verified against **CLI v2.1.49** on the
**Awesome Motive Enterprise** seat (`claude auth status` = claude.ai/firstParty,
`ANTHROPIC_API_KEY` unset).

**Implementation deltas from this doc (all verified live):**
- `--max-turns` gone → transform uses `--tools ""`; reason uses
  `--tools "Read,Grep,Glob"` + `--add-dir <kbRoot>` (see §1 update above).
- Added `--no-session-persistence` (one-shot; nothing written to `~/.claude`).
- Spawn-arg construction extracted early into the pure `build-args.js` (Slice 6
  asked for this) so mode selection + the DEC-G lockdown are unit-tested now.
- Bridge strips `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` (force Enterprise
  OAuth) and `CLAUDECODE`/`CLAUDE_CODE_SSE_PORT` (defuse the nested-session
  guard) from the child env.
- User text is piped via **stdin**, not argv (no ARG_MAX / escaping issues).
- `frame-call.js` is a durable in-repo dev harness (replaces the planned
  ad-hoc `echo`-into-bridge command); README documents the exact commands.

**Round-trip results:** transform fixed "teh cat sat on teh mat and it dont
move" → "The cat sat on the mat and it didn't move." Reason mode grepped the KB
and returned the `?omip=IP_ADDRESS` geo-test technique **with the doc URL**
(early Slice-6 KB-efficacy proof). Cold spawn ≈ 5 s (transform), ≈ 26 s (reason).

> ⚠️ **Discrepancy for Slice 6 — `support-desk` is NOT a git repo.** This doc
> (§6, Slice 6 DEC-G check) assumes it's git-versioned and uses
> `git -C <kbRoot> status --porcelain` as the PII acceptance check. That command
> errors ("not a git repository") on the actual KB. The DEC-G *structural*
> guarantee still holds (reason mode's `--tools "Read,Grep,Glob"` excludes
> Write/Edit/Bash), but **Slice 6 must replace the git check** with a
> no-new-files check (e.g. snapshot `find <kbRoot> -newer <stamp>` before/after,
> or a mtime diff). Flagged, not silently resolved.

**Original goal:** a working native-messaging host that turns
`{ system, user, model }` stdin frames into `{ text }` / `{ text: "", error }`
frames by spawning `claude -p`.

**New files:**

| File | Contents |
|---|---|
| `bridge/claude-bridge.js` | `#!/usr/bin/env node`. Native-messaging stdio protocol (4-byte little-endian length prefix + JSON — both directions). Request shape: `{ system, user, model?, mode? }` with `mode` defaulting to `"transform"`. **transform**: spawn `claude` with `-p`, `--output-format json`, `--system-prompt <system>`, `--model <model or default>`, `--max-turns 1`, no tools. **reason** (DEC-F): same, but cwd = the configured `kbRoot`, `--allowedTools "Read,Grep,Glob"` (read-only — never Write/Edit/Bash, per DEC-G), and a higher `--max-turns` (start at 12; tune in Slice 6). If `kbRoot` is unset or the directory is missing, silently execute as `transform` — this is the teammate degradation path. Parse the JSON; reply `{ text: result.result }` on success, `{ text: "", error: "<stderr/subtype>" }` on failure. Also handle `{ ping: true }` → `{ pong: true, ok: true, kb: <bool> }` (used by options Test connection). Node builtins only. |
| `bridge/config.json` (gitignored) + `bridge/config.template.json` | Bridge-side machine-local settings: `{ "kbRoot": "/Users/<me>/Projects/support-desk" }`. Machine paths never enter the extension or chrome.storage. `install.sh` offers to set it. |
| `bridge/frame-codec.js` | Pure encode/decode of the length-prefixed framing — extracted so it's unit-testable without stdin. |
| `bridge/host-manifest.template.json` | `{ "name": "com.optinmonster.claude_bridge", "type": "stdio", "path": "__BRIDGE_PATH__", "allowed_origins": ["chrome-extension://__EXTENSION_ID__/"] }` |
| `bridge/install.sh` | Resolves the absolute bridge path + prompts for the extension ID, renders the template into `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.optinmonster.claude_bridge.json`, `chmod +x` the bridge. macOS first (this team is on macOS); leave a TODO stanza for Linux/Windows paths. |
| `bridge/README.md` | Install steps, prerequisite (`claude` CLI installed + logged in to the Enterprise seat), how to test standalone. |

**Do not assume CLI flags** — run `claude --help` and one manual
`claude -p "say ok" --output-format json` first; adjust flags to what the
installed version accepts (§1 lists what the docs said on 2026-07-10).

**Default model:** accept `model` pass-through; when absent use a
`DEFAULT_MODEL` constant in the bridge (start with the value already used by
[providers/claude.js](../providers/claude.js), `claude-sonnet-4-6`, unless the
user says otherwise).

**Tests:** `tests/unit/frame-codec.test.js` (round-trip encode/decode, partial
chunks, >1 frame per chunk). The spawn path is exercised manually:
`echo` a framed request into `node bridge/claude-bridge.js` and inspect the
framed reply (document the exact command in bridge/README.md).

**Docs same commit:** ARCHITECTURE.md layer-4 table gains
`bridge/claude-bridge.js`; note the `bridge/` folder in 00-INDEX or
CONTEXT-MAP as appropriate.

**Acceptance:** manual framed round-trip returns polished text produced by the
Enterprise-seat login (verify with `claude /status` or equivalent that no
`ANTHROPIC_API_KEY` is set in the environment).

---

### Slice 2 — Layer-4 provider + dispatcher + manifest

**Goal:** `callLLM({ provider: "claude-code", … })` works end-to-end from the
side panel.

**New file — `providers/claude-code.js`:**
- `export async function callClaudeCode({ model, system, user, mode })` —
  promisified
  `chrome.runtime.sendNativeMessage("com.optinmonster.claude_bridge", { system, user, model, mode })`,
  mapping `chrome.runtime.lastError` and absent responses to
  `{ text: "", error: "…" }`. Also `export async function pingClaudeCode()`
  for the options page (sends `{ ping: true }`).
- No apiKey parameter. No domain knowledge. Same return contract as siblings.

**Edit — [providers/index.js](../providers/index.js):**
- Add `"claude-code": callClaudeCode` to `DISPATCHERS`.
- Introduce `const KEYLESS_PROVIDERS = new Set(["claude-code"])`; skip the
  `apiKey` lookup/check for key-less providers (pass no key down).
- `callLLM` accepts an optional `mode` (`"transform"` default | `"reason"`)
  and passes it down. **Only `claude-code` honours it**; the HTTP providers
  ignore it — that is the agnosticism contract (DEC-F): switching the
  provider to Gemini/OpenAI/direct-Claude still works, just without the KB
  reasoning layer. No caller sets `mode` in this slice — compose adopts it in
  Slice 6.
- Keep the current resolution order (explicit `provider` → default → first
  available). Default resolution changes land in Slice 3, not here.

**Edit — [manifest.json](../manifest.json):** add `"nativeMessaging"` to
`permissions`. (No `host_permissions` change — the bridge is not an HTTP host.
Do **not** remove the existing API host permissions; other providers still
use them.)

**Tests (same commit — the hook requires it):**
- `tests/unit/claude-code-provider.test.js` — chrome-mock `sendNativeMessage`:
  success, `lastError`, no-response, ping.
- Extend the dispatcher coverage (new `tests/unit/providers-dispatch.test.js`
  if none exists): key-less provider dispatches without a key; keyed providers
  still error without a key; unknown provider unchanged.
- Extend [tests/helpers/provider-mock.js](../tests/helpers/provider-mock.js)
  if the new provider needs representation there.

**Manual smoke (records the transport assumption):** load the unpacked
extension, open the side panel console, run a `callLLM({ provider:
"claude-code", system: "reply OK", user: "ping" })`. If `sendNativeMessage`
is unavailable from the side panel context, implement the background.js relay
contingency (§3) — in that same slice, with a background test.

**Acceptance:** side-panel smoke returns model text; `npm test` green; no
entry-point file gained business logic.

---

### Slice 3 — Storage: availability, default resolution, third-party gate

**Goal:** `claude-code` becomes the default when enabled; Gemini/OpenAI are
opt-in (per DEC-A/B/E).

**Edit — [lib/storage.js](../lib/storage.js)** (169 lines now; watch the
250-line hard limit — if the additions push past ~250, split per the
house rule, e.g. `lib/storage-providers.js`, and update ARCHITECTURE.md):
- New `KEYS`: `claudeCodeStatus` (`{ enabled, lastPingAt, lastPingOk }`,
  written only from the options Test-connection flow) and
  `allowThirdParty` (boolean, default `false`).
- `getAvailableProviders()` becomes: `claude-code` when
  `claudeCodeStatus.enabled && lastPingOk`; `claude` when keyed;
  `gemini`/`openai` when keyed **and** `allowThirdParty`.
- Default resolution used by the dispatcher: `getDefaultProvider()` if the
  stored value is currently available; else `claude-code` if available; else
  first available. Implement as a new storage function (e.g.
  `resolveDefaultProvider()`) so the ordering is testable in isolation, and
  have `providers/index.js` use it.
- **Back-compat, no assumptions:** existing users have `default_provider`
  set in `chrome.storage.sync`. Do not clobber it. The resolution rule above
  only *fills gaps* (unset or unavailable default). Note this in the DECISIONS
  entry.

**Tests:** extend `tests/unit/storage.baseline.test.js` + new
`tests/unit/provider-availability.test.js` covering every row of the
availability matrix and the resolution ordering (incl. "stored default is a
now-gated third-party provider").

**Docs same commit:** DECISIONS.md gains the availability/gating entry if not
already ratified in Slice 0; 01-PRODUCT.md provider description updated.

**Acceptance:** with a mocked enabled bridge and no keys at all, dispatcher
resolves to `claude-code`; with `allowThirdParty=false`, `gemini`/`openai`
never appear in availability even with keys present.

---

### Slice 4 — Options UI

**Goal:** the agent can enable/test the connector and consciously opt in to
third-party providers.

**Edit — [options.html](../options.html) + [options.js](../options.js):**
- New "Claude (Enterprise via Claude Code)" section: status dot, **Test
  connection** button → `pingClaudeCode()` (imported from
  `providers/index.js` surface — add a re-export there rather than importing
  `providers/claude-code.js` directly, which ARCHITECTURE.md forbids from
  entry points) → writes `claudeCodeStatus` via storage.js. Short install
  pointer to `bridge/README.md` when ping fails.
- Move Gemini/OpenAI key fields under a collapsed "Third-party providers"
  block gated by the `allowThirdParty` toggle, with the data warning line.
- Default-provider `<select>` reflects the new availability rules (it already
  re-renders from `getAvailableProviders()` — verify, don't assume).
- Keep each handler thin (~30 lines); anything smarter goes to storage.js or
  a service.

**Also:** [sidepanel.js](../sidepanel.js) provider selects (`:179–:202`)
re-read availability — verify they pick up `claude-code` and render a human
label ("Claude (Enterprise)"). Labels are entry-point concerns; a small
`PROVIDER_LABELS` map in the entry point is fine.

**Tests:** extend `tests/ui/a2-options-v3.test.js` (or add
`tests/ui/options-claude-code.test.js`): ping success/failure paths write the
status key; toggle hides/shows third-party fields; select contents match the
availability matrix.

**Acceptance:** fresh profile → open options → Test connection → status turns
green → side panel drafts with zero API keys stored.

---

### Slice 5 — Report-pipeline timeout + un-pend verification

**Goal:** the weekly reporting flow works through the connector; the pend is
formally lifted.

**Edit — [lib/text-polish.js](../lib/text-polish.js)** (per DEC-D): timeout
becomes provider-aware. Keep the module pure: have it ask the dispatcher/
storage which provider will serve the call (e.g. a
`resolveDefaultProvider()` import) and pick `5000` vs `CLAUDE_CODE_TIMEOUT_MS
= 30000`; callers stay untouched. Every other D32 behaviour (min length,
silent fallback, 2.5× guard) is preserved — tests must prove that.

**Verification pass (no code unless something is broken):** exercise each
caller from §2.1 through the connector —
1. compose (generate a draft),
2. quick-transform (retone + translate),
3. suggestions (managerial-rewrite → proposal fires),
4. library-rank in LLM mode (toggle from strip — Lex stays the default),
5. **the full report flow**: enter an ask with a deliberate typo + hypothesis
   bullets → generate prompt → build report → confirm the polish actually ran
   (typo fixed, not the silent fallback) → Slack delivery unchanged.

**Tests:** extend `tests/unit/text-polish.test.js` (timeout selection per
provider; fallback contract intact). Integration test if a seam allows:
report build with a mocked slow provider still completes with originals.

**Docs same commit:** DECISIONS.md D32 gets an addendum (timeout now
provider-aware); [09-STRATEGY-AND-LAUNCH.md](09-STRATEGY-AND-LAUNCH.md) or
OPEN-THREADS.md records that the LLM-features pend is lifted and why the data
path is now acceptable; SESSION-HISTORY.md updated.

**Acceptance:** all five flows produce model output via the bridge with no API
keys configured; report typo demonstrably polished; `npm test` green.

---

### Slice 6 — KB reasoning layer (support-desk) — after Slice 5

**Goal (DEC-F/G):** draft composition reasons *with* the local knowledge base —
the model itself searches `patterns/` and `drafts/` during generation — while
teammates without the KB get byte-identical behavior to a plain LLM call.

**Context a fresh session needs:** `~/Projects/support-desk` is the owner's
durable KB, built across ~68 Claude Code sessions. Key surfaces:
`patterns/INDEX.md` (symptom / error-string → `area.md#anchor` lookup table),
`patterns/<area>.md` (structured Symptom/Cause/Fix/Verify/Source sections),
`drafts/` (one md per past ticket: raw message, drafted reply, final sent),
`CLAUDE.md` (tone + verification rules — auto-loaded by Claude Code when cwd
is the KB, which is a feature: extension drafts inherit the same operating
rules as Claude Code sessions). The repo is git-versioned and must **never**
gain content from the extension (DEC-G).

**Changes:**
- [lib/compose.js](../lib/compose.js): pass `mode: "reason"` on its `callLLM`
  call, and add one short system-prompt section (in
  [lib/prompts.js](../lib/prompts.js) if that's where prompt text lives —
  verify) telling the model: *if a local knowledge base is available, grep
  `patterns/INDEX.md` for the customer's symptoms and read the matching
  section(s) before drafting; prefer verified patterns over general knowledge;
  cite the doc URL from the pattern when used.* The instruction must be
  harmless when tools are absent (transform fallback) — phrase it
  conditionally.
- Bridge (already built in Slice 1): confirm reason-mode flags against the
  installed CLI; tune `--max-turns`.
- Compose timeout/UX: reason mode is an agentic run (expect 30–90 s). Verify
  compose's existing async/error path tolerates that; add a status line
  ("consulting knowledge base…") in sidepanel.js if the wait is otherwise
  silent. No timeout change if compose has none today — verify before adding.
- **No other call site changes mode.** polish/retone/translate/suggestions/
  ranker stay `transform` — they are mechanical transforms and paying agentic
  latency there would hurt (5 s polish budget, D32).

**Degradation matrix to test (bridge-side + provider tests):**

| kbRoot config | Folder exists | Behavior |
|---|---|---|
| set | yes | reason mode: cwd=kbRoot, Read/Grep/Glob |
| set | no (teammate copied config) | silent transform fallback |
| unset (default install) | — | silent transform fallback |
| provider ≠ claude-code | — | HTTP provider ignores `mode` entirely |

**PII acceptance check (DEC-G):** after a reason-mode compose run on a real
ticket, `git -C <kbRoot> status --porcelain` is empty and no new files exist
under kbRoot. This is expected to hold by construction (no Write/Edit/Bash in
the allowlist) — the check proves the allowlist actually took effect on the
installed CLI version.

**KB-efficacy acceptance check:** compose a ticket whose correct answer exists
only in the KB, not in general model knowledge — e.g. "how do I test a
geo-location rule without a VPN?" must produce the `?omip=IP_ADDRESS`
technique from `patterns/display-rules.md`, ideally with the doc URL. Run the
same prompt in transform mode and confirm the difference.

**Tests:** bridge mode selection + fallback rows above (unit-testable in
`frame-codec`/bridge request-builder if the spawn arg construction is
extracted as a pure function — extract it); compose passes `mode` (extend
compose tests with provider-mock asserting the arg).

**Docs same commit:** DECISIONS.md entries for DEC-F/G if not already present;
01-PRODUCT.md gains the KB-reasoning description; a one-line note added to
support-desk's own CLAUDE.md is **optional** and owner-authored (this repo's
code never writes there).

---

### Slice 7 — Hardening + close-out (optional but recommended)

- **Latency option:** if per-call `claude -p` spawn is too slow in daily use,
  switch `providers/claude-code.js` to `chrome.runtime.connectNative` (one
  long-lived port; the bridge process stays warm and serially handles frames).
  Bridge already speaks framed stdio, so this is transport-only.
- **Pre-warm:** fire a `{ ping: true }` on side-panel open so the first real
  call doesn't pay host-startup cost.
- **Error surfacing:** a one-line "bridge not installed / claude not logged
  in" hint in the side panel when `claude-code` is default but a call errors.
- Final docs sweep: 01-PRODUCT.md present-state, CONTEXT-MAP.md tour,
  INTEGRATIONS.md entry for the bridge.

---

## 6. Known risks — do not discover these the hard way

| Risk | Detail | Mitigation (slice) |
|---|---|---|
| **Polish timeout** | `text-polish.js` gives the LLM **5 s**; spawning `claude -p` cold typically takes longer. Without DEC-D the report polish would *silently always fall back to originals* and look "fine" while doing nothing. | Slice 5 (provider-aware timeout) + Slice 6 pre-warm. Acceptance test explicitly proves the polish ran. |
| **CLI flag drift** | Claude Code flags change across versions. | Slice 1 verifies against the installed `claude --help`; bridge README records the tested version. |
| **`sendNativeMessage` context** | Assumed callable from the side panel; verified only in docs, not in this repo yet. | Slice 2 smoke test + documented background-relay contingency. |
| **Seat rate limits** | Connector usage draws from the same Enterprise-seat pool as interactive Claude Code sessions. Fine for polish/rank volume; watch compose-heavy days. | Note in options UI copy; revisit if limits bite. |
| **Per-user install step** | Every machine needs bridge install + `claude` login. Not centrally deployable via the extension alone. | `bridge/install.sh` + README (Slice 1); options page points to it on ping failure (Slice 4). |
| **Existing stored defaults** | Users may have `default_provider: "gemini"` in sync storage. | Slice 3 back-compat rule: never clobber, only fill gaps; gated providers drop out of *availability*, which the resolution rule already handles. |
| **Hook discipline** | Pre-commit blocks code-without-tests. | Every slice lists its tests; never `--no-verify` without explicit user approval. |
| **Reason-mode latency** | Agentic compose (KB grep/read turns) runs 30–90 s vs a few seconds for a plain call. | Slice 6 status line + generous budget; per-call fallback: the compose UI's provider select can still pick a plain provider for a quick draft. |
| **KB write exposure** | Any tool beyond Read/Grep/Glob in reason mode could let ticket PII reach the KB. | DEC-G structural lockdown (`--tools "Read,Grep,Glob"` — Write/Edit/Bash don't exist) — **verified on CLI v2.1.49 in Slice 1**. NOTE: the KB is **not** a git repo, so the acceptance check must be a no-new-files scan, not `git status` (see Slice 1 discrepancy note). |

---

## 7. How to run this plan in a fresh session

Prompt template for any slice:

> Read `ARCHITECTURE.md`, `docs/CONVENTIONS.md`, and
> `docs/10-CLAUDE-CODE-CONNECTOR.md` in full. Re-verify the §2 audit facts you
> depend on (grep `callLLM`, re-read the files you'll touch). Then execute
> **Slice N** exactly as written: files named as specified, tests in the same
> commit, docs updates in the same commit, acceptance criteria demonstrated
> before you report done. Flag — do not silently resolve — anything that
> contradicts this document.

Slices 1 and 2 can be built in either order (1 first is easier to verify);
3 → 4 → 5 → 6 are sequential (6, the KB reasoning layer, requires the
provider-aware timeout work from 5). Slice 7 is optional hardening, last.
Slice 0 gates everything.
