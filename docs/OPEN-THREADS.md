# Open Threads

A parking lot for things mentioned, considered, or partially settled — but not yet filed as a feature, bug, or decision. The point is that the next AI / contributor doesn't re-litigate them from scratch.

When a thread becomes a real plan, promote it to [02-BUGS.md](02-BUGS.md), [03-FEATURES.md](03-FEATURES.md), or [DECISIONS.md](DECISIONS.md) and remove it from here.

If a thread sits here for a long time and nothing changes, that's a decision in itself — leave it noted.

---

## OT-1 — Ready-to-Send rate divergence between WPSA AI and the extension

**Context.** The WPSA AI's reporter infers Ready-to-Send from "no internal escalation notes recorded" — a heuristic that drifted between two runs (91.6% → 100%) over overlapping date ranges. The extension's `lib/audit-metrics.js readyToSend` is computed from real `outcome` field values in `draft_log`.

**Status.** Documented in [DECISIONS.md D25](DECISIONS.md#d25). The digest now quotes the extension's number for accountability and notes the WPSA AI's number is directional. No action item.

**When it matters again.** If the manager starts referencing the WPSA AI's number as authoritative, the agent should explicitly cite the extension's number with sources. If WPSA gains a structured "draft state" field, both numbers can converge.

---

## OT-2 — Bobby Deraco's email rendered with markdown brackets

**Context.** During the Intercom debugging, the snapshot for `webtech@synapseresults.com` came back with `email` literally set to `[webtech@synapseresults.com](mailto:webtech@synapseresults.com)` — markdown notation in the actual contact field. Likely an import artefact.

**Status.** [lib/intercom-snapshot.js stringifySnapshot](../lib/intercom-snapshot.js) passes this through to the LLM verbatim. The LLM doesn't seem to be confused by it (it parses the email correctly). No fix shipped.

**When it matters again.** If we want clean-looking emails in the customer chip header, strip markdown brackets in `stringifySnapshot` before output. ~3 lines.

---

## OT-3 — Pre-existing orphan drafts in `draft_log`

**Context.** During the multi-window-bug investigation, we ran a console snippet that listed all compose drafts with `conversation_id: null`. The snippet revealed orphans from sessions before the windowId fix was shipped. We relinked one (the OptinMonster ticket #41816) but left others as-is.

**Status.** F7 (orphaned-draft finder + relink button) is filed in [03-FEATURES.md](03-FEATURES.md) as the proper UI for this. Console snippet works as a manual fallback.

**When it matters again.** If F7 ships, the first run will surface every historical orphan. Some will be relinkable; others (no clear ticket-side memory) will be best deleted. UX should support both.

---

## OT-4 — `last_ticket_opened` storage key is global, not per-window

**Context.** With two side panels across two windows, both panels share `last_ticket_opened` in `chrome.storage.local`. Whichever ticket page fired the signal most recently wins. Not the bug that bit on 2026-04-29 (that was [DECISIONS.md D13](DECISIONS.md#d13)) but a real cross-window correctness issue.

**Status.** Not filed. Possible future fix: namespace the key as `last_ticket_opened_<windowId>` with each side panel listening only for its own.

**When it matters again.** If multi-window phantom re-renders of the revisit card become a real complaint. Until then, the windowId fix has eliminated the symptom.

---

## OT-5 — `draft_log` read-modify-write race (theory C, F8)

**Context.** Diagnosed during the multi-window-bug investigation. Two concurrent panels writing to `draft_log` at once can race: panel A reads `[a, b, c]`, panel B reads same, A writes `[a, b, c, A_new]`, B writes its mutation back as `[a, b, c, B_new]` and silently overwrites A. Real but **not** what bit us on 2026-04-29.

**Status.** Filed as F8 in [03-FEATURES.md](03-FEATURES.md). Single-writer architecture via the background service worker. Deferred until a real RMW collision is observed.

**When it matters again.** If a draft silently disappears from `draft_log` after the agent confirms it was created. Or if the agent adopts a routine multi-window workflow.

---

## OT-6 — Pagination state on data refresh in Recent drafts tab

**Context.** If a new draft lands while the agent is on page 3 of Recent drafts, the array gains an entry at the top. The paginator recomputes `totalPages` and the row content shifts forward by one. The agent stays on page 3 but sees different rows.

**Status.** Acceptable per the implementation note. Same behaviour as Gmail. No surprise jumps because sort is consistent.

**When it matters again.** If the agent reports "I scrolled to the right page and a new draft came in and now I'm on the wrong row." At that point we'd add a "stay anchored" mode that keeps the current draft id visible across re-renders.

---

## OT-7 — Charts library size

**Context.** [lib/charts.js](../lib/charts.js) is a hand-written ~120-line inline-SVG renderer because MV3 CSP forbids loading Chart.js or D3 from a CDN. Vendoring Chart.js (~200KB) would be the alternative.

**Status.** Hand-written. Five chart types cover everything the digest needs (counter / bar / pie / line / stackedBar). No fix shipped.

**When it matters again.** If we want richer charts (heatmaps, scatter, multi-axis lines) the cost of expanding `charts.js` may exceed Chart.js vendor + tree-shake. Re-evaluate then.

---

## OT-8 — Bold/italic/lists not yet preserved in side-panel textareas

**Context.** Currently the three customer-facing textareas (`#draft`, `#promptExtra`, `.mgr-rw-text`) are plain `<textarea>` elements. Pasting from Summernote loses all formatting (bold, italic, lists, hyperlinks). Inserting an AI rewrite into Summernote sends plain text.

**Status.** F6 (rich-text editor) filed in [03-FEATURES.md](03-FEATURES.md). The user explicitly wants full WYSIWYG, not the markdown round-trip alternative. Estimated ~1 day of work. Not yet started.

**When it matters again.** When the agent's manager hyperlinks something in a rewrite and the link is lost on capture. Or when the agent needs to send a list-formatted reply.

---

## OT-9 — TrustPulse and Beacon library coverage

**Context.** Library seeds are dominated by OptinMonster scenarios. TrustPulse and Beacon have a handful each.

**Status.** Intentional, not a bug ([DECISIONS.md D23](DECISIONS.md#d23)). The agent handles low TP / Beacon volume mostly solo; reuse opportunities are smaller; building speculative seeds without compose data isn't worth it.

**When it matters again.** When TP or Beacon volume rises and the agent wants library reuse for those products. F5 (product toggle on the WPSA prompt builder) is a prerequisite signal — when F5 lands and the agent starts using it, the library will auto-grow with TP / Beacon entries.

---

## OT-10 — `max_tokens` is hardcoded to 2048 in Claude provider

**Context.** [providers/claude.js](../providers/claude.js) sends `max_tokens: 2048`. Gemini doesn't pass a max; OpenAI uses its own default. Inconsistent across providers.

**Status.** Bug E2 in [02-BUGS.md](02-BUGS.md) — set `MAX_OUTPUT_TOKENS = 4096` in providers/index.js, pass through to all three. Not yet shipped.

**When it matters again.** Long replies get truncated mid-Version-B. The agent has run into this once or twice; not a routine problem yet.

---

## OT-11 — `consumeIncomingSelection` runs once at init, never re-checks

**Context.** When the side panel boots and there's an `incoming_selection` already in `chrome.storage.local` (right-click → Send to Draft fired before the panel was open), `consumeIncomingSelection` reads + clears it once. Subsequent right-clicks while the panel is open are caught by the `chrome.storage.onChanged` listener.

**Status.** Works correctly — confirmed during the F1 follow-up investigation. The boot-time consume + the live listener cover all cases.

**When it matters again.** If a side panel reload races with a fresh selection write and the listener doesn't fire because the value didn't change. Edge case; not seen in practice.

---

## OT-12 — Quick transforms have no `customer_context_used` field

**Context.** Compose drafts get `customer_context_used: true | false` based on whether Intercom context was passed. Quick transforms don't have a corresponding field.

**Status.** Not filed. Quick transforms operate on a selection, not a customer context, so the field doesn't apply. The audit metric `customerContext.ratePercent` correctly excludes quick transforms (computed only from compose drafts).

**When it matters again.** If quick transforms gain customer-aware behaviour (e.g., "make this friendlier — but they're a VIP, so extra-warm"). Then the field becomes meaningful.

---

## OT-13 — The `Cancel` button on the unresolved-draft modal isn't sticky

**Context.** Clicking Cancel sets `modalDismissedForId`, but the next compose-related `draft_log` write resets it. The user explicitly chose this in [DECISIONS.md D14](DECISIONS.md#d14) — they almost never use Cancel.

**Status.** Status quo. One-line fix available if needed.

**When it matters again.** If Cancel becomes a routine part of the agent's flow. Until then, leave alone.

---

## How to add a new thread

Append. New entry as `## OT-X — short title`. Context, Status, "When it matters again." Two paragraphs each is plenty. If a thread grows beyond that, it's probably ready to graduate to a feature or bug entry.
