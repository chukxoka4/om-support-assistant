# WPSA Reporter — Friday Workflow

How to use the WPSiteAssist Reporting tool (your custom FreeScout / HelpScout-fork dashboard) to produce the weekly digest's product-friction half in ~15 minutes.

This complements [06-REVIEW-PLAN.md](06-REVIEW-PLAN.md). Together they cover both halves of the Friday digest.

---

## What the tool actually gives you

The reporting tool has **two surfaces**. Each answers different questions; combine them.

### Surface 1 — Dashboards (read directly, no prompt needed)

Two prebuilt views, both filterable by date and other dimensions:

**Overview Report** — team-wide week:
- Total Conversations
- Avg Daily Conversations
- Total Replies
- Avg Daily Replies
- Replies to Resolve
- Customers Helped
- TTFR (Time To First Response)
- Happiness Score
- Total New Conversations chart
- Total Conversations Worked On chart
- Total Replies Sent chart
- Total Resolutions chart

**Team Performance** — per-agent row:
- Conversations
- Per Day
- Replies
- Per Day
- Avg Followup Time
- Happiness (Good / Okay / Bad / Total)
- Times 1st
- TTFR

You have an **Export CSV** button on Team Performance. Use it.

**These are real measured numbers.** Capture them weekly. Don't ask the AI to recompute them.

### Surface 2 — The AI chat
A prompt area where you can ask qualitative questions. Use it for:
- Friction leaderboard (which features cost the most replies)
- Time-waster identification (repetitive explanations)
- O/I framework verdicts (specific product fixes)
- Macro / Saved-Reply suggestions
- Knowledge-gap detection (where you typed the same thing 3+ times)

**Don't use it for:**
- Numbers already on the dashboard (it can drift; the dashboard can't)
- Anything that requires deterministic counting — the AI is heuristic
- "Ready-to-Send" rate (the AI guesses from "no internal notes" — that's not a real measurement; use the extension's `readyRate` for this number)

---

## The Friday 15-minute routine

In order. No tool-switching mid-flow.

1. **Open Overview Report** (date range = last week, Mon–Sun). Screenshot or write down: Total Conversations, Total Replies, TTFR, Happiness Score, Replies to Resolve. *(2 min)*
2. **Open Team Performance** (same date range, filter to yourself). Note: your conversations, replies, times 1st, TTFR. Click Export CSV — keep the file in case you want it later. *(2 min)*
3. **Switch to the AI chat.** Run the prompts in the order below. *(8 min total)*
4. **Compose the digest** — paste the dashboard numbers + the AI's answers into your weekly format. *(3 min)*

That's it. The whole job, every Friday.

---

## The prompt library

Five prompts. Run in the order listed. Each builds on the previous answer.

### Prompt 1 — Friction Leaderboard

Use this every week. Source of the "what slowed customers down" line in the digest.

```
Date Range: <Mon> – <Sun>, 2026
Product Focus: OptinMonster

Analyze all tickets I handled during this week and answer:

1. Top 3 product friction points: name each, give the count of unique
   conversations and the total reply volume tied to each.
2. For the #1 friction point, summarise customer sentiment in one
   sentence (frustrated / confused / accepting / etc) with one
   representative customer quote anonymised.
3. Cross-check: is the #1 friction point a known issue (recent product
   change), a documentation gap, or a UI workflow problem? Pick one
   and justify in two sentences.

Format the answer as a short table for #1 followed by bullet points
for #2 and #3.
```

### Prompt 2 — Time-Waster Identification

Spots repetitive explanations that are ripe for a saved reply or library entry.

```
Looking at the same week of tickets:

1. Identify the top 2 explanations I wrote multiple times this week
   (3+ instances counts as repetitive).
2. For each, draft a 2–3 sentence saved-reply that captures the core
   answer plus the next-step ask to push diagnostic work back to the
   customer.
3. Distinguish between "product friction" repetitions (customer
   confusion about a feature) and "process" repetitions (TrustPilot
   pitches, follow-up nudges, internal handoffs). Don't conflate them
   — process repetitions are not product issues.
```

The "don't conflate" line matters. The first run mixed your TrustPilot pitch with mobile-workaround explanations. They're different — one is sales process, the other is product friction.

### Prompt 3 — O/I Framework Verdict

Surfaces one specific product fix per week with a defensible Outcome / Input read.

```
For the #1 friction point identified above, apply the Outcome / Input
framework:

- Outcome: estimate weekly support hours saved if this is fixed at
  product level. Show your math (number of conversations × avg replies
  × your est. minutes per reply).
- Input: based on what you can see in customer logs and ticket
  language, is the product team likely already aware of this? If so,
  is the fix in early access, in-flight, or undiscovered?
- Verdict: yes/no/conditional. If conditional, name the condition.

If you are uncertain about Input, say so explicitly rather than
guessing.
```

The "explicitly rather than guessing" line is a hedge against confident hallucination. The AI doesn't actually have engineering visibility unless tickets mention it.

### Prompt 4 — Knowledge Gap Hunt

Targets your A1 (measured baseline) story. Answers: where are *you* the bottleneck?

```
Reviewing my replies this week:

1. Are there topics where my replies were notably longer or required
   more back-and-forth than my peers' replies on similar tickets?
2. Are there topics I escalated, asked for help on internally, or
   added internal notes to?
3. Pick one as my "growth area for next week" and recommend one
   library entry / saved reply I should build to close the gap.
```

This one is uncomfortable — it surfaces where you're slower. Run it anyway. The supervisor wants honest growth pitches, not victory laps.

### Prompt 5 — Trend Compare (use from week 2 onward)

```
Compare this week (<dates>) to last week (<dates>) on these axes:

- Total conversations I handled
- Top 3 friction categories (did the leaderboard change?)
- Time-waster patterns (did last week's saved-reply suggestion reduce
  this week's repetitions?)

Flag any new pattern that wasn't present last week.
```

The "did last week's saved-reply reduce this week's repetitions" line is the AI Loop measurement your supervisor cares about. If you build a macro and the topic disappears next week, the loop worked.

---

## Drift and verification

The AI is non-deterministic — same prompt twice can give different answers. Two examples from your runs:

- **Apr 19–25 first run:** 91.6% Ready-to-Send.
- **Apr 21–27 re-run:** 100% Ready-to-Send. Same heuristic ("no internal notes"), different windows, different absolute number.

How to make the digest robust:

1. **Lean on the extension's `readyRate` for the actual number** — it's computed from real `outcome` field values, not heuristics. The WPSA AI's number is a directional signal, not the source of truth.
2. **Run each prompt once per Friday.** Don't re-run hoping for a "better" answer — that's how you accidentally cherry-pick.
3. **Save the raw AI output** alongside the digest. If anyone questions the numbers later, you have the receipts.
4. **When the AI says "X% of tickets," follow up by asking it to count.** The dashboard often has the real count one tab away. Cross-check before quoting.

---

## Data quality notes specific to your setup

- **"Help Scout data does not natively track unsent draft states"** — the AI confirmed this in the re-run. Means: the *real* Ready-to-Send rate lives in this extension's `draft_log`, not in WPSA. Quote both numbers in the digest with their sources.
- **Happiness Score with small samples is noisy.** Two ratings ≠ a happiness rate. Note the sample size in the digest. *"83% team happiness (n=11), my 50% (n=2 — too small for trend)."*
- **Billing & cancellations dominate volume (69% of conversations Apr 21–27).** This is normal for the OM product but it skews "% of total" metrics. Filter by category when looking at product friction.

---

## What to lead the digest with — Apr 21–27

The AI surfaced one strong "Owner-grade" insight that the supervisor will love:

> Mobile vs Desktop campaign separation drove **44 messages across 25 unique conversations** this week (~45% of non-billing product friction). The product team has **already built the unified-device feature** — it's currently in early access. Verdict: **promote to GA next month** to eliminate ~45% of non-billing product support volume permanently.

That's the kind of item your supervisor wants: a specific feature, a specific volume reduction, a specific recommendation, and *low engineering input* (it's already built — the input is "ship the early-access feature").

Lead the next digest with this. It's the strongest "Owner" pitch the data has produced.

---

## Standing items to keep an eye on

- **Drift on Ready-to-Send.** Track the WPSA AI's number AND the extension's `readyRate` weekly. If they diverge significantly, investigate.
- **Sample-size hygiene.** Always report (n=...) on Happiness, Ready-to-Send, anything < 50 events.
- **Mobile/desktop GA push** — once it ships, watch for the friction count to drop. That's your "AI Loop made it visible, product fixed it" proof point for the Q2 review.
