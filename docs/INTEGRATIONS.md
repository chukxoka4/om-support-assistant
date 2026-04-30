# Integrations & Glossary

External systems this project depends on, the specifics of how we talk to them, and the field/value glossary that ties the OM business domain to the code.

If you're touching anything that sends data outside the extension or reads from another tool, this is the file. Cross-link to [DECISIONS.md](DECISIONS.md) for the *why* of any non-obvious choice.

---

## Glossary — terms and acronyms

| Term | What it means here |
|---|---|
| **OM** | OptinMonster — the agent's primary product. The lead-capture / popup tool. |
| **TrustPulse** | Sister product. Social-proof notifications. Lower ticket volume than OM. |
| **Beacon** | Sister product. Lead-magnet builder. Lowest ticket volume of the three. |
| **WPSA** | WPSiteAssist — internal name for the agent's ticketing tool, a custom fork of FreeScout. |
| **FreeScout** | Open-source HelpScout clone. WPSA is built on top of it. |
| **Summernote** | The WYSIWYG editor inside FreeScout / WPSA used for composing replies. Stores HTML. |
| **Intercom** | Customer-data platform. We use it for the customer chip (plan / engagement / tags / NPS). |
| **MV3** | Manifest V3 — the Chrome extension manifest version this project targets. |
| **Compose pipeline** | The flow that takes draft + dropdowns + context and returns two AI rewrites. |
| **Library / Playbook** | `library_v3` in storage. Same thing seen from two angles — the system calls it library, the agent / supervisor call it the Playbook. |
| **Revisit loop** | The two-step "what went forward + what was the outcome" flow that captures Step 1 / Step 2 data. |
| **Quick transform** | Right-click → improve / translate. Single-output flow, separate from compose. |
| **AI loop** | Compose → manager review → suggestion proposal → human accept → library mutation. The whole feedback cycle. |
| **O+I framework** | OptinMonster's internal "Opportunity + Impact" framework for prioritising work. See [DECISIONS.md D11](DECISIONS.md#d11). |

---

## OM business domain

| Term | What it means | Where it appears |
|---|---|---|
| `vbp_pro` | "Value Bundle Plan — Pro." A subscription tier. Custom-attribute value of `user_level`. | Intercom, customer chip |
| `vbp_growth` | Subscription tier — Growth (one tier above Pro / Plus). | Intercom, customer chip |
| Basic / Plus / Pro / Growth | Plan tier names as the customer sees them. May map to `user_level` differently — we don't have an authoritative mapping. | Marketing site, billing |
| `subscription_status` | "active" / "cancelled" / "past_due" / "churned" / etc. Drives most of the customer-chip health rules. | Intercom custom attribute |
| `MRR` | Monthly Recurring Revenue. Numeric. Some workspaces store it; ours might not. | Intercom (probed, may be null) |
| `nps_score` | Customer's last NPS survey result, 0–10. Probed under several keys. | Intercom (likely empty in our workspace) |
| `is_trial_user`, `trial_ends_at` | Trial state. We probe `trial_ends_at` and several aliases. | Intercom |
| `is_shopify_user`, `has_wordpress_site` | Product-installation flags. Visible in Custom section of the chip. | Intercom |
| `account_id` | Internal OM user ID. Not currently used by the extension but visible in chip's Custom section. | Intercom |
| `payment_gateway` | "stripe" / "paypal" — flows that affect cancellation UX. | Intercom |
| `renewal_date_at`, `renewal_period` | Renewal info. Custom section formats `renewal_date_at` as a relative + ISO date via the timestamp detector. | Intercom |
| `purchased_addons`, `integrations_count`, `total_campaigns_count` | Product-usage metrics. Custom section displays them verbatim. | Intercom |

The agent has **no Intercom UI access** — the API key was inherited from a separate cross-sell project ([DECISIONS.md D10](DECISIONS.md#d10)). Field discovery is by inspecting actual responses. The diagnostic console log in `loadCustomerHealth` prints the snapshot + custom_attribute keys verbatim on first fetch per email.

---

## WPSA (WPSiteAssist Reporting)

The ticketing tool the agent works in daily. A customised FreeScout fork with a separate reporting/analytics surface called **WPSA Reporting**.

### Two surfaces, two purposes

**Dashboards** (read directly):
- Overview Report: Total Conversations, Total Replies, TTFR, Happiness Score, Replies to Resolve.
- Team Performance: per-agent Conversations, Replies, Happiness (good/okay/bad/total), Times 1st, TTFR. Has an Export CSV button.

**AI chat tab** (qualitative analysis):
- The agent pastes a structured prompt; the AI chats over the filtered ticket data and returns analysis.
- Used for the digest's qualitative half: friction leaderboard, time-waster identification, O/I verdict, knowledge gaps.

### Important caveats

- **Ready-to-Send rate is heuristic in WPSA, real in the extension.** WPSA infers it from "no internal escalation notes recorded." The extension computes it from real `outcome` values in `draft_log`. Quote both with sources noted ([DECISIONS.md D25](DECISIONS.md#d25)).
- **AI output is non-deterministic.** Same prompt twice can return different numbers. Lock the prompt structure (we do, via [lib/prompt-generator.js](../lib/prompt-generator.js)) and treat one Friday run as the official number for that week.
- **Sample size hygiene matters.** Happiness Score with n=2 is meaningless. Always note (n=...) for small samples. The schema has a `caveats` array for the AI to flag this.

### The prompt schema

See [docs/AUDIT-AND-REPORT.md](AUDIT-AND-REPORT.md) for the full JSON schema and how the prompt builder generates it programmatically. Short version: `meta` + `totals` + `categories` + `frictionLeaderboard` + `timeWaster` + `oiVerdict` + `knowledgeGaps` + `caveats`. Validated by [lib/wpsa-schema.js](../lib/wpsa-schema.js) before render.

---

## Intercom

Customer data platform. We talk to it via [lib/intercom-client.js](../lib/intercom-client.js).

### Workspace specifics

- **Region:** US. Base URL `https://api.intercom.io`. Hardcoded; no toggle. The cross-sell project the agent inherited the key from authenticates against the same host, so this is correct ([DECISIONS.md D9](DECISIONS.md#d9)).
- **Auth:** Bearer token (the API key). Stored in `chrome.storage.sync` under `intercom_config: { apiKey }`.
- **Workspace ID:** `yot32p6u` (per the cross-sell config notes). Not used directly in code.
- **API version:** `2.10`. Sent as `Intercom-Version: 2.10` header.

### Endpoints used

| Endpoint | Purpose |
|---|---|
| `POST /contacts/search` | Find a contact by email (`{field: "email", operator: "=", value: <email>}`) and the `searchCustomers` partial-match flow. |
| `POST /conversations/search` | Last-90-days conversations for a contact id. **Returns empty for OM customers because OM doesn't use Intercom for support tickets** ([DECISIONS.md D9](DECISIONS.md#d9)). Kept in code for forwards compatibility. |
| `GET /contacts/<id>/companies` | Single GET to join company name + seat count. Failures degrade silently to null. |
| `GET /me` | Used by the "Test connection" button to verify auth without touching customer data. |

### Defensive field probing

[lib/intercom-client.js](../lib/intercom-client.js) probes multiple plausible key names for each concept ([DECISIONS.md D10](DECISIONS.md#d10)):

| Concept | Keys tried (priority order) |
|---|---|
| Plan | `user_level → plan → plan_name → subscription_plan` |
| Subscription status | `subscription_status → status → subscription_state` |
| MRR | `mrr → monthly_revenue → plan_value → monthly_value` |
| Trial end | `trial_ends_at → trial_end → trial_expires_at → trial_expiry` |
| NPS | `nps_score → nps → latest_nps_score → latest_nps` |

First non-null match wins. If none match, the field is `null` in the snapshot and the chip skips that line.

### The customer-chip flow

1. On panel init / tab change / `last_ticket_opened` storage signal, [`loadCustomerHealth`](../sidepanel.js) runs.
2. Confirms an Intercom key is set; if not, hides the chip silently.
3. Resolves `getCurrentTicket()` → conversation_id.
4. Scrapes emails from the OM ticket page via `getCustomerEmailsFromPage(tabId)` ([lib/ticket.js](../lib/ticket.js)).
5. For each unique email, calls `loadSnapshot(email)` from [lib/intercom-snapshot.js](../lib/intercom-snapshot.js):
   - 5-minute cache in `chrome.storage.session` keyed by email.
   - `force: true` bypasses the cache (used by Retry button).
6. Renders the chip with one tab per email when there are several.
7. On first fetch per email, logs the raw snapshot + custom_attribute keys to the console under `[OM/Intercom]` for diagnostic.

### Health classification rules

[lib/intercom-snapshot.js classifyHealth](../lib/intercom-snapshot.js) returns `{ tier, reason }` with this precedence:

| Tier | Triggers |
|---|---|
| **VIP** | `vip` tag (overrides everything) |
| **Red** | subscription cancelled / past_due / churned · `churn-risk` tag · hard-bounced · unsubscribed AND inactive 60d+ · NPS ≤ 4 |
| **Yellow** | trial ending in ≤7d · `trial-extended` tag · last seen >30d · NPS 5–7 |
| **Green** | NPS ≥ 8 · active subscription + last seen ≤14d · active subscription + email click in last 30d |
| **Grey** | found:false OR no definitive signal (default) |

Rules are evaluated top-to-bottom; first match wins. The `reason` string surfaces in the chip header tooltip and the expanded "Why:" line.

---

## Provider dispatch (Gemini / Claude / OpenAI)

The compose pipeline and quick transforms both go through [providers/index.js](../providers/index.js).

### Defaults

| Provider | Default model | `max_tokens` |
|---|---|---|
| Gemini | `gemini-2.5-flash` | unconstrained (we don't pass it) |
| Claude | `claude-sonnet-4-6` | 2048 (hardcoded — bug E2 plans 4096 across all) |
| OpenAI | `gpt-4o` | passes via `max_tokens` |

The user's "default provider" is stored in `chrome.storage.sync` under `default_provider`. They can override per-request via the side-panel provider dropdown.

### Auth

API keys live in `chrome.storage.sync` under `api_keys: { gemini, claude, openai }`. Set in Options or side-panel Settings (mirrored). Available providers are computed by `getAvailableProviders()` — only providers with non-empty keys appear as options.

### Error shape

Every provider returns either `{ text, provider }` on success or `{ error, provider }` on failure. The dispatcher doesn't throw; consumers check for `result.error`.

---

## Summernote (the OM ticket editor)

The WYSIWYG editor inside the OM ticket page. Stores reply content as HTML. Cursor manipulation, paste handling, and toolbar actions are all Summernote-managed.

### What the extension does with it

- **Insert into ticket:** [`insertVersion`](../sidepanel.js) calls `chrome.scripting.executeScript` with a function that finds the active editor (`.note-editable`) and inserts the rewrite at the cursor. Currently inserts plain text; F6 will switch to HTML.
- **Right-click selection capture:** [content.js](../content.js) and [content-overlay.js](../content-overlay.js) hook `getSelection()` to capture text. Currently captures `toString()` (plain); F6 spec captures HTML.
- **Quick transform overlay:** [content-overlay.js](../content-overlay.js) renders a dark/light-adaptive overlay with typewriter reveal over the selection. The improve/translate result is shown there with Replace / Copy / Cancel actions. **Replace** uses Summernote's API to swap the original selection for the new HTML.

### Interaction quirk

The OM ticket UI sometimes renders email addresses as `[email](mailto:email)` inside the anchor's textContent (markdown-like, not HTML). The customer-email regex in [lib/ticket.js EMAIL_RX](../lib/ticket.js) is anchored to extract just the email out of either form. Don't simplify the regex without checking real OM markup again.

---

## Web Speech / clipboard / Notification APIs

Used in passing:
- `navigator.clipboard.writeText` — Slack snippet copy, prompt copy, output copy buttons.
- `chrome.notifications` — used for revisit reminders (legacy, may be inert).
- `URL.createObjectURL` + Blob — for downloading the weekly report HTML.

None require special configuration. Extension permissions are declared in [manifest.json](../manifest.json) at the top level.

---

## Storage layout

Where every persistent piece of data lives.

### `chrome.storage.local` (per-machine, per-profile, persistent)

| Key | What it holds | Owner |
|---|---|---|
| `library_v3` | Library / Playbook entries (seeds + auto-generated). Array. | [lib/library.js](../lib/library.js) |
| `library_v3_seeded` | Boolean flag — has the seed import run? | [lib/library.js](../lib/library.js) |
| `draft_log` | Every compose, every quick transform, every Step-1/2 outcome. Array, append-only. | [lib/storage.js](../lib/storage.js) |
| `revisit_dismissals` | Per-conversation modal-dismissed timestamps. Object. | [lib/storage.js](../lib/storage.js) |
| `user_taxonomy` | Custom dropdown values added at runtime. Object with `goals`, `audiences`, `tones`, `modes`. | [lib/storage.js](../lib/storage.js) |
| `incoming_selection` | Right-click → Send to Draft scratch payload. Cleared after consumption. | [content.js](../content.js), [sidepanel.js](../sidepanel.js) |
| `last_ticket_opened` | Most-recent ticket conversation_id. Drives revisit-card refresh. | [content-ticket.js](../content-ticket.js) |
| `revisit_pending_action` | Pending Step-2 navigation hint. | [content-ticket.js](../content-ticket.js) |

### `chrome.storage.sync` (cross-device, settings-class)

| Key | What it holds |
|---|---|
| `api_keys` | `{ gemini, claude, openai }` — provider keys |
| `default_provider` | String — `"gemini"` / `"claude"` / `"openai"` |
| `intercom_config` | `{ apiKey }` |
| `report_config` | `{ agentName }` — the report author name |
| `ranker_mode` | `"lexical"` or `"llm"` — F1 toggle |

### `chrome.storage.session` (cleared on browser close)

| Key | What it holds |
|---|---|
| `intercom_snapshot_cache` | Per-email Intercom snapshots. 5-min TTL. |

---

## Where to look when an integration breaks

| Symptom | First file to check | Then |
|---|---|---|
| AI rewrites empty / wrong shape | [lib/compose.js](../lib/compose.js) `parseStructuredOutput` | [lib/voice.js](../lib/voice.js) for the system prompt |
| Provider auth error | [providers/index.js](../providers/index.js) | provider-specific file (`providers/claude.js` etc.) |
| Customer chip blank | [lib/intercom-snapshot.js](../lib/intercom-snapshot.js) `loadSnapshot` | console — look for `[OM/Intercom]` log |
| Customer chip says "no record" | [lib/intercom-client.js](../lib/intercom-client.js) `findContactByEmail` | inspect raw response in console; the email may not be in this Intercom workspace |
| Email not detected on ticket page | [lib/ticket.js](../lib/ticket.js) `extractEmailsFromDom` | OM ticket markup — selector may have changed |
| WPSA JSON validator rejects a real response | [lib/wpsa-schema.js](../lib/wpsa-schema.js) | the AI's output — likely an enum value drift; either widen the validator or tighten the prompt |
| Insert into Summernote does nothing | [sidepanel.js](../sidepanel.js) `insertVersion` | confirm the active editor selector still matches `.note-editable` |
| Quick transform overlay broken | [content-overlay.js](../content-overlay.js) | [lib/quick-transform.js](../lib/quick-transform.js) for the LLM call |
