# Q2/Q3 Review Plan

How the work in this repo maps to the supervisor's Q2/Q3 expectations, what's already in place, what to build, what to ask for, and how to pitch it on May 1.

This is a personal-strategy doc, not a product spec. The product specs live in [00-INDEX.md](00-INDEX.md).

---

## The supervisor's expectations (paraphrased)

1. **Move from "Student" to "Owner"** — by end of Q2, high "Ready-to-Send" rate. First draft is the final version.
2. **Master the AI Loop** — power user, measurable boost in tickets-per-hour without quality drop.
3. **Write the Playbook** — identify three biggest inbox time-wasters; build AI-assisted workflows to kill them.
4. **Direct Product Feedback** — ready answer in every 1:1: *"What is the #1 thing slowing customers down this week?"* Backed by analytics, not gut.
5. **Owning Your Data** — pitch a sustainable reporting format by **May 1, 2026**.
6. **O/I Framework as standard first step** — every new agent/project idea gets an Outcome-vs-Input pass before build.

Q2 goal: weekly summary becomes the team's go-to for "where the product is winning and where the inbox is struggling."

---

## What's already built vs what's missing

| Ask | What exists | What's missing |
|---|---|---|
| Ready-to-Send rate | `lib/metrics.js` already computes `readyRate` and `managerRate` from `draft_log`. OM AI reporter measured 91.6% for April 19–25. | Surfacing the number weekly without manual export. |
| AI Loop measurable | Whole extension *is* the loop: compose → review → manager rewrite → C1+C2 library refinement. | Counting it. Suggestions accepted vs rejected, library entries grown, customer-context-used %. |
| Playbook | `library_v3` **is** the Playbook. 18 seeds + auto-grown entries. F1 retrieves. Manager rewrites refine. Export/Import wired. | A one-page narrative explaining "library = playbook" with shareable exports. |
| #1 thing slowing customers | F2 customer-context every reply. OM AI reporter already named *Display Rules / Live vs Preview* as #1 for April 19–25. | A weekly digest combining OM AI reporter + extension data. |
| O/I framework as first step | Not directly in code. | A small habit / template, not a build. |
| May 1 reporting pitch | Computation exists in storage. | An "Audit" surface that emits the digest in one click. |

**Read this carefully:** every "missing" item is packaging, not building. Don't build new tools — surface what already exists.

---

## Two data sources, used right

### 1. OM ticketing platform's built-in AI reporter
- **Scope:** every ticket. All customers. The macro view.
- **Strength:** product friction across the inbox. The April 19–25 run produced exactly the analysis the supervisor wants — Display Rules, PayPal cancellation UX, UTM tracking — with reply counts and O/I verdicts.
- **Use it for:** the "what's slowing customers down" half of the digest.

### 2. This extension's `draft_log` + `library_v3`
- **Scope:** only tickets composed through the side panel. Probably most, not all.
- **Strength:** the AI loop itself — what the OM reporter can't see.
- **Use it for:** "is the AI-first approach working?" Half of the digest.

The two together answer both supervisor questions in one weekly post.

---

## What to ask for

What you actually need that you don't already have:

1. **30 minutes from your supervisor** to walk through `library_v3` and the customer chip. Don't pitch — *show*. They'll repeat back "this is the Playbook + the customer-context system." That reframes future conversations.
2. **Sustained admin/analyst access** to the OM ticketing reporting tab. You proved the tool works; ask for ongoing access without re-authentication friction.
3. **One peer "draft reviewer"** for the first two weeks of Q2. A senior agent who'll give brutal feedback on the 8% that needs review. (Gemini got this one right.)
4. **A Slack channel or Asana project** to post the Friday Digest. Logistics.

What you do NOT need (despite generic advice):

- **Mixpanel / Heap / product analytics.** You're support, not product. The OM AI reporter already has the relevant signals.
- **A sandbox OM account.** Useful for verification but tangential to the reporting goal.
- **Browser scraping extensions.** The OM tool exposes the data via its AI reporter — you proved it.

---

## The May 1 pitch — draft

> **Weekly Friction & AI-Loop Digest — proposed format**
>
> Starting May 1, every Friday by 4 PM I'll post one digest with two halves.
>
> **Half 1 — Inbox performance (the AI loop)**
>
> Pulled from the side-panel extension. One row per metric, week-over-week:
>
> - Ready-to-Send rate
> - Manager-rewrite rate (and trend)
> - Tickets composed through AI loop (total)
> - Library entries at start vs end of week (Playbook is auto-growing)
> - Suggestions accepted / rejected / deferred (proof the library is learning content, not just scoring)
> - Customer-context coverage (% of replies enriched with Intercom data)
>
> **Half 2 — Product friction (the customer view)**
>
> Pulled from the OM ticketing platform's built-in AI reporter:
>
> - Top 3 friction points of the week + ticket count
> - The #1 time-waster + the AI shortcut I built to kill it
> - One O/I-framework verdict — a specific product fix and the input/output trade-off
>
> **Standing artefacts**
>
> - **Playbook export** in our shared drive — every refined library entry is an SOP. New entries auto-flagged.
> - **AI-shortcut macros** (Live-Site Diagnostic, Auto-Renew vs Cancel, …) in [chosen tool]. Updated when a new repeating pattern emerges.
>
> Pitching this because it answers both your questions in one place — *is the AI loop working?* and *what's slowing customers down?* — and the data is largely automated.

---

## Two-week build plan (now → May 1)

1. **Audit tab in the side panel** (highest leverage). Surfaces every Half-1 metric. "Copy digest" button emits the markdown. ~4–6 hours.
2. **Run the OM AI reporter for April 26 – May 2** (this Friday). Now you have two data points; trend lines start to mean something.
3. **Promote the Live-Site Diagnostic** from a Gemini suggestion to a real `library_v3` entry — proper dropdowns, full instruction text. The suggestion strip will offer it next time.
4. **O/I framework template** — three cells (Outcome / Input / Verdict). Notion page or markdown doc. 10 minutes.
5. **Book the 30-minute walkthrough** with your supervisor. Show, don't pitch.

---

## Honest gaps the extension can't fix

1. **No baseline before "the AI loop."** 91.6% is excellent, but A1 (measured baseline) wants trend. Two weeks = baseline. Four weeks = trend. Eight weeks = the Q2 review story. **Start collecting now.**
2. **No direct engineering relationship.** O/I verdicts need a PM to land them. The supervisor is your channel — every digest must name *one* product fix recommendation. After eight weeks: eight prioritized ideas with data attached.

---

## Rubric placement and headroom

After the work in this repo plus the digest cadence:

- **Capable** — solid across the board (C1–C5 met).
- **Adaptive** — A1 (measured baseline), A2 (personalised templates), A6 (library learns) met. A3 (voice of customer) and A4 (proactive outreach) still missing.
- **Transformative** — foothold in T3 (account intelligence) via the chip; the rest still missing.

A4 (proactive outreach) is unlocked by F3 in [03-FEATURES.md](03-FEATURES.md). A3 by F4. Don't promise these for Q2 — promise them as Q3 stretch.

---

## What the OM AI reporter can do for you (drilled out separately)

The reporter is the higher-leverage tool of the two. It sees every ticket, not just the ones routed through the extension. The April 19–25 run already proved it can produce friction leaderboards, time-waster identification, O/I verdicts. The next step is to learn the prompt patterns and cadence so you can run it consistently each Friday in under 15 minutes.

Continued in conversation with the assistant — TBD a follow-up doc once we've nailed the prompt set.
