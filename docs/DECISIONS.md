# Decisions

Architecture-decision-record style entries for the non-obvious calls. Each one names the decision, the alternatives considered, the reasoning, and when it might be worth revisiting. Read this before re-litigating something — most of these went through a real debate the first time.

Format: short. Two paragraphs maximum per decision. If a decision needs more than that, it should probably be its own doc.

---

## D1 — Vitest, not Jest

**Decision.** Test runner is Vitest with happy-dom for DOM tests; node environment otherwise.

**Why.** The codebase is plain ESM (no bundler, no TypeScript). Jest needs Babel config to handle ESM cleanly; Vitest just runs. Coverage via `@vitest/coverage-v8`. Husky + lint-staged for the pre-commit hook.

**Revisit when.** Vitest changes its module resolution defaults in a way that breaks our happy-dom + node split, or if we ever bring in a build step where Jest's wider ecosystem becomes worth the friction.

---

## D2 — No auto-apply on suggestions, ever

**Decision.** When the LLM proposes a library refinement (after a managerial rewrite), the agent reviews via the side-panel queue. Accept opens an inline preview showing current vs proposed text. Apply commits the change. Reject / Defer leave the entry untouched.

**Why.** The user's explicit rule. Library entries influence every future compose for that scenario; a wrong auto-apply propagates errors everywhere. Cost of a wasted click is small; cost of a silent bad mutation is large. This was set early in the project as a mandate.

**Revisit when.** The agent has months of data showing accepted-suggestion outcomes are reliably better than rejected ones, AND there's a dedicated audit log of what was applied so reverts are cheap.

---

## D3 — `split_entry` never auto-creates an entry

**Decision.** When a suggestion proposes splitting one library entry into two, the system flips the suggestion's status to `needs_manual` instead of mutating anything. The UI surfaces a "needs manual review" affordance with the suggested instruction visible; the agent creates the new entry by hand.

**Why.** Auto-creating a new library entry is a multi-field decision (product, dropdowns, scenario_title, scenario_summary, scenario_instruction). Getting any of those wrong pollutes the library forever. Easier to ask the human to do it once, with full context.

**Revisit when.** We have UI to "create new entry from this suggestion" that's at least as good as the regular library-create flow.

---

## D4 — All `proposed_changes` apply on Accept, not just the first

**Decision.** When the agent clicks Apply, every change in the suggestion's `proposed_changes` array runs in order. Multiple `refine_instruction` entries: the last wins as the live instruction; every refine still increments `rewrites_absorbed`. Multiple taxonomy adds: all land. `split_entry` mixed in: other changes apply, suggestion's status flips to `needs_manual`.

**Why.** The first version of [`applySuggestion`](../lib/library.js) consumed only `proposed_changes[0]` and silently dropped the rest. Real-world LLM output has 3–4 changes per suggestion; dropping all but the first lost most of the signal. Fixed in the C2 follow-up commit.

**Revisit when.** The agent finds a class of suggestions where the multi-change behaviour is worse than single-change. Until then it's strictly more correct.

---

## D5 — Drop `edited` and `rewrote` outcomes; keep `correction_logged` only as history

**Decision.** Removed `edited` and `rewrote` from the outcome enum. `correction_logged` is no longer set anywhere. Three terminal outcomes only: `sent`, `manager_approved`, `managerial_rewrite`.

**Why.** They were referenced in `lib/storage.js`, `lib/metrics.js`, and `sidepanel.js` but were never assigned anywhere — pure dead branches. Bug B1. Removed in the same commit.

**Revisit when.** A new outcome category genuinely needs tracking. Don't resurrect the old names — they were never wired correctly.

---

## D6 — F1 ranker has both Lex and LLM modes with a toggle

**Decision.** The in-textarea suggestion strip ranks library entries by either lexical scoring (instant, local) or LLM scoring (round-trip, smarter). A toggle in the strip header lets the agent switch. Default is Lex; mode is persisted in `chrome.storage.sync`.

**Why.** Initial proposal was Lex with optional LLM later. The user pushed back: *"this should be how it works, not lexical comparison. Or give me a switcher to compare so I can see and decide what to drop."* So both shipped, with the toggle as the experiment harness.

**Revisit when.** The agent has run with both for ~a month and one is clearly better. Drop the loser. Until then, both stay.

---

## D7 — Clear button resets the ranker mode to Lex

**Decision.** Hitting the Clear button (which empties the form) also resets the ranker mode to Lex.

**Why.** "Clear" should mean "fresh sheet" — including the ranker. Without this, after switching to LLM and clearing the form, the next draft is silently still on LLM. Surprising. The reset reinforces "Lex is the safe default."

**Revisit when.** The agent finds themselves repeatedly switching back to LLM after Clear. Five clicks in a session = signal to drop this rule.

---

## D8 — No MCP server folder for Intercom

**Decision.** F2 originally proposed an in-repo MCP server at `mcp-intercom/`. We removed it. The Intercom integration is extension-internal only, via [lib/intercom-client.js](../lib/intercom-client.js) and [lib/intercom-snapshot.js](../lib/intercom-snapshot.js).

**Why.** The MCP would only matter if we wanted Intercom tools available from Claude Desktop or other MCP clients outside this extension. The extension itself just does `fetch` to `api.intercom.io`. Adding an MCP folder doubles the maintenance surface for zero in-product benefit. The user's view: *"if there's no MCP required for this to happen, then fine."*

**Revisit when.** A second consumer of the Intercom client appears (Claude Desktop daily, an Outlook plugin, etc). Until then, single-consumer = no MCP.

---

## D9 — F2 health rules dropped conversation counts; pivoted to subscription + engagement

**Decision.** [lib/intercom-snapshot.js classifyHealth](../lib/intercom-snapshot.js) does NOT use `conversationsLast90d` or `openConversations` as primary signals. Health is derived from `subscription_status`, engagement (last_seen, last_email_open, last_email_click), and tags (vip / churn-risk / trial-extended).

**Why.** OptinMonster routes support tickets through WPSA / FreeScout, not Intercom. So `POST /conversations/search` returns zero for every customer. The original rules treated long-tenured customers with zero Intercom conversations as auto-Healthy — which is everyone. Misleading. The user spotted this on a 1110-day vbp_pro customer and we pivoted.

**Revisit when.** OM ever consolidates support into Intercom. Until then, the conversation fields stay in the snapshot for forwards compatibility but don't drive health.

---

## D10 — Intercom field probing is defensive (multiple keys per concept)

**Decision.** [lib/intercom-client.js](../lib/intercom-client.js) probes a list of plausible custom-attribute keys for each concept it cares about: plan (`user_level → plan → plan_name → subscription_plan`), NPS (`nps_score → nps → latest_nps_score → latest_nps`), MRR (`mrr → monthly_revenue → plan_value → monthly_value`), trial end (`trial_ends_at → trial_end → trial_expires_at → trial_expiry`), subscription status (`subscription_status → status → subscription_state`).

**Why.** The agent has no Intercom UI access. The API key was inherited from a separate cross-sell project. We don't know exactly what custom attributes this workspace stores under what names. Probing is the only way to be honest about discovery. The first successful key wins; if none match, we return `null` rather than guessing.

**Revisit when.** We get a definitive list of attribute names from the Intercom workspace owner. At that point, simplify to one key per concept and remove the probing.

---

## D11 — O+I framework alignment is in the WPSA AI's `oiVerdict` schema, not in the report renderer

**Decision.** The WPSA AI is asked to fill three fields per report: `primaryGrowthLever` (enum: churn / reactivations / upgrades / cost_reduction / none), `mveBootstrap` (one-sentence "scrappier alternative first" answer or null), `escalationVerdict` (playbook_only / escalate / watch). The report renderer just displays them.

**Why.** The company's O+I framework demands every escalation be tied to a CS growth lever. Forcing the AI to commit to one (or to `cost_reduction` / `none`) is honest about whether something is actually growth-relevant. Most weeks the verdict will be `playbook_only` — by design. The framework's whole point is to help say "no" faster.

**Revisit when.** The supervisor changes the framework. Update the prompt + schema validator + the report renderer's pill colours together.

---

## D12 — Report distribution is HTML download + Slack snippet, no hosting

**Decision.** The Audit tab generates a self-contained HTML file (inline CSS, inline SVG charts, no `<script>`, no `<link>`) that downloads via Blob, plus a Slack-ready markdown snippet auto-copied to the clipboard.

**Why.** User explicitly ruled out hosted dashboards. Email-attachable, Slack-uploadable, viewable offline, viewable on any device. Manager opens the HTML for the full picture; reads the snippet inline in Slack for the quick summary. Both work without an internet connection after generation.

**Revisit when.** The team standardises on a hosted analytics tool that can ingest the JSON. Until then, the file-on-disk distribution is unbeatable for a one-person workflow.

---

## D13 — `currentWindow: true` was the wrong default; we now pin to `windowId`

**Decision.** The side panel caches `state.windowId` at panel init via `chrome.windows.getCurrent()`. All `chrome.tabs.query()` calls in [sidepanel.js](../sidepanel.js) use `windowId: state.windowId` instead of `currentWindow: true`.

**Why.** `currentWindow: true` resolves to the most-recently-focused window, not necessarily the side panel's own window. With two side panels across two browser windows (cross-monitor), focus drift caused Generate to query the *wrong* window's tab — the URL didn't match the OM ticket regex — the draft was logged with `conversation_id: null`. Bug bit on 2026-04-29; relinked manually; fix shipped same day.

**Revisit when.** Chrome MV3 changes `currentWindow` semantics, or we deliberately want cross-window queries (we don't).

---

## D14 — Cancel on the unresolved-draft modal is intentionally non-sticky

**Decision.** The native `window.confirm()` dialog on ticket pages re-arms when a *compose-related* `draft_log` write happens — even if the agent clicked Cancel. We did NOT remove the `modalDismissedForId = null` reset in the storage listener.

**Why.** The user's preference: *"I rarely click Cancel — almost never. So for now, leave it."* The fix for the typing-pause bug filtered quick-transforms out of the listener (so improve-text doesn't re-trigger), but compose drafts still re-arm Cancel. If this proves annoying later, deleting one line in [content-ticket.js](../content-ticket.js) makes Cancel sticky.

**Revisit when.** The agent reports clicking Cancel and immediately getting re-prompted on a normal flow.

---

## D15 — Quick transforms filtered out of the ticket-page storage listener

**Decision.** [content-ticket.js](../content-ticket.js) has a mirror of `lib/draft-log-changes.js shouldPromptForChange`. The listener bails when the only `draft_log` changes are quick-retone or quick-translate entries.

**Why.** `window.confirm()` blocks all JS on the tab including `content-overlay.js`'s typewriter animation. Without the filter, every improve-text call paused mid-stream while the modal popped. Quick transforms are independent of the revisit flow and shouldn't trigger it.

**Revisit when.** A new draft type appears that should also be filtered out of the listener (none currently planned).

---

## D16 — Pagination resets to page 1 on filter change; per-tab page state otherwise persists

**Decision.** In the Library & Learning panel, the All / Seeds / Generated filter chip change resets `state.libraryPanel.libraryPage = 1`. Switching tabs (library / review / drafts) preserves each tab's own page number.

**Why.** Mixing filters and stale page numbers creates "wait why am I on page 5 of 2?" confusion. Reset on filter change is the safe default. Per-tab page state is fine because each tab is its own data set; switching tabs doesn't change what page makes sense for the other tabs.

**Revisit when.** Someone wants per-chip page state (unlikely — single agent, small library).

---

## D17 — The library is the Playbook; Reset means re-seed

**Decision.** `library_v3` doubles as the agent's "Playbook." Each entry is an SOP for a scenario, with score history that shows what's worked. Reset to seeds wipes everything and re-seeds from `prompts/om-seeds.json`. Import / Export is wired in both Options and the side-panel Settings, with explicit Merge / Replace confirmation step.

**Why.** Maintaining a separate "Playbook" doc and a library would drift. The library is already the source of truth for compose; making it the Playbook by definition keeps them in sync. Exports are the shareable artefact ([decision dropped a v2 fossil](DECISIONS.md#d18) in A1).

**Revisit when.** The Playbook needs structured fields the library schema doesn't have (e.g., escalation rules, ownership tags). At that point, decide whether to extend the schema or fork.

---

## D18 — `library_v3` is the only library; the v2 store was retired

**Decision.** `library_override` (v2) was deleted in bug A1. `prompts/library.json` was deleted. All library reads/writes go through `library_v3` in `chrome.storage.local`.

**Why.** Two stores caused four bugs (Options Export / Import / Reset all pointed at v2 while the runtime used v3). Killing v2 collapsed all four into zero. Confirmed before deletion that nothing in the runtime path read v2.

**Revisit when.** Never. v2 is gone.

---

## D19 — F8 (single-writer for `draft_log`) deferred, not fixed

**Decision.** The read-modify-write race on `draft_log` is real but not what bit on 2026-04-29 (that was [D13](#d13)). We filed F8 as a future feature rather than fixing it now.

**Why.** Routing all writes through the background service worker as a single writer adds ~5–10ms per write and a non-trivial code path. The race only manifests under genuine concurrent writes from multiple windows, which is uncommon. Fixing it without a forcing event invites scope creep. Trade-off: keep the bug filed, fix when there's a real failure.

**Revisit when.** A real RMW collision is observed in `draft_log`. F8 in [docs/03-FEATURES.md](03-FEATURES.md) describes the single-writer architecture.

---

## D20 — Rich-text editor proposal: rejected the markdown-only fallback

**Decision.** F6 (rich-text editor for draft / prompt / manager-rewrite textareas) is filed but **not** as the markdown round-trip approach. The user wants full WYSIWYG: bold, italic, lists, hyperlinks, paragraphs, all preserving on round-trip with Summernote.

**Why.** Markdown round-trip was simpler but only preserved hyperlinks, not bold/italic/lists. The user's reply: *"I don't want to see HTML tags but it is not only Hyperlinks I want — I want all kinds of formatting bold, italics, bullets, numbers."* So F6 specifies a contentEditable + sanitiser + paste handler. Single feature, ~1 day of work, filed for later.

**Revisit when.** F6 ships. Until then, textareas remain plain text. House style covers most formatting needs.

---

## D21 — Default-expanded for Library & Learning section

**Decision.** The "Library & Learning" section is `class="open"` by default in `sidepanel.html`. `init()` calls `renderLibraryPanel()` if the section is open at boot.

**Why.** User said: *"I guess it can stay expanded. We can always change that later."* Reduces clicks; tile + tabs are immediately visible. The toggle still works for users who want to collapse.

**Revisit when.** The panel becomes too cluttered or pagination doesn't manage the volume — but pagination is exactly the lever for that.

---

## D22 — Three metric tiles are clickable, three aren't

**Decision.** Library prompts / Drafts (30d) / Suggestions tiles open the matching tab in Library & Learning. Ready-to-send / Manager approved / Quick transforms tiles are display-only.

**Why.** The clickable three each map cleanly to a tab destination. The non-clickable three don't. Faking "click for details" on tiles with nowhere meaningful to go would be a UX lie.

**Revisit when.** A future tab makes one of the other tiles navigable (e.g., a "drafts by outcome" view would map Ready-to-send + Manager approved). Wire them in then.

---

## D23 — TrustPulse and Beacon coverage is intentionally thin

**Decision.** Library seeds in [prompts/om-seeds.json](../prompts/om-seeds.json) and product docs in [prompts/products/](../prompts/products/) are dominated by OptinMonster scenarios. Few entries for TrustPulse or Beacon.

**Why.** Per the user: *"TrustPulse and Beacon have less entries because they have lower ticket volume overall, and I am in charge of sending most emails from these by myself."* Not a bug, not a coverage gap. The agent's daily mix is OM-heavy; the library reflects that.

**Revisit when.** TrustPulse or Beacon volume rises to where the agent wants library reuse for those products. F5 (product toggle) is a prerequisite for that pivot.

---

## D24 — Email is read from the page, not from any AI inference

**Decision.** [lib/ticket.js extractEmailsFromDom](../lib/ticket.js) scrapes `ul.customer-contacts li.customer-email` on the OM ticket page using a regex against the anchor's `href` and `textContent`. No AI involved.

**Why.** The page already renders the customer's email — there's no need to pay for an LLM call to identify it. Regex is deterministic and works even with the OM UI's quirky `[email](mailto:email)` rendering.

**Revisit when.** The ticket page rewrites the customer-contacts element class names. The selector + regex would need updating in lockstep.

---

## D25 — The OM AI reporter's "Ready-to-Send" rate is heuristic; the extension's is real

**Decision.** The digest (Section 2) reports the extension's `readyRate` from `lib/audit-metrics.js` — computed from real `outcome` field values in `draft_log`. The WPSA AI reporter's Ready-to-Send number (which is heuristic — "no internal escalation notes recorded") is treated as directional, not as the source of truth. Both can be quoted in the digest with sources noted.

**Why.** WPSA / FreeScout doesn't natively track unsent draft states. The AI infers Ready-to-Send from the absence of internal notes. That number drifted between two runs of the same prompt (91.6% → 100% on overlapping date ranges). The extension measures the real thing because *it* logs the outcome.

**Revisit when.** WPSA gains a structured "draft state" field. Until then, two numbers, two labels.

---

## How to add a new decision

Append to this file. New entry as `## DXX — short title`. Decision · Why · Revisit when. Two paragraphs max. If you can't fit it in two paragraphs, the decision is probably not yet decided — keep iterating.
