# Mockups

Text mockups for visual review before any UI is built.

---

## M1 — Suggestions strip (F1)

```
[ DRAFT TEXTAREA ]
"Customer says their popup isn't showing on mobile. They've checked
the campaign is live but see nothing on iPhone."
                                                       [ Clear ]

┌─ Library suggestions ────────  Ranker: ( Lex ◉  LLM ○ ) ─┐
│ ⭐ Exit-intent not triggering on mobile        [score 18] │
│   Explain OM's mobile exit-intent behaviour…     [ Use ▸ ]│
│ ⭐ Campaign not displaying on site             [score 16] │
│   Ask customer to confirm campaign status…       [ Use ▸ ]│
│ • Targeting rules not firing as expected       [score  9] │
│   Ask for the exact URL tested…                  [ Use ▸ ]│
│ • DSD (Device Specific Designs) behaviour      [score  7] │
│   Explain DSD's documented behaviour…            [ Use ▸ ]│
│ • Cloudflare / caching causing load issues     [score  5] │
│   Ask customer to confirm caching setup…         [ Use ▸ ]│
└──────────────────── 5 of 24 entries · No close match? ────┘

[ Generate ▸ ]
```

### Empty state

```
┌─ Library suggestions ────────  Ranker: ( Lex ◉  LLM ○ )  ─┐
│   No close match — Generate will create a new entry.      │
└───────────────────────────────────────────────────────────┘
```

### LLM ranker error state

```
┌─ Library suggestions ────────  Ranker: ( Lex ○  LLM ◉ )  ─┐
│   ⚠ LLM ranker failed — switch to Lexical or retry.       │
│   [ Retry ]  [ Use lexical ]                              │
└───────────────────────────────────────────────────────────┘
```

---

## M2 — Customer health chip (F2)

```
┌────────────────────────────────────────────────────────┐
│ Ticket #48291  ·  jane@acme.com                        │
│ ┌─[ 🟡 At watch ]──────────────────────────────────┐   │
│ │ Pro · 412 days · last seen 3d                    │   │
│ │ 4 tickets in 90d · NPS 6 · tags: trial-extended  │   │
│ │ ▸ Last 3: integration broken, billing q, refund  │   │
│ └──────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────┘
```

### Color states

- 🟢 **Healthy** — green pill
- 🟡 **At watch** — yellow pill
- 🔴 **At risk** — red pill
- ⚪ **No data** — grey pill (snapshot returned `found: false`)

### VIP override

```
┌─[ 🟢 VIP ]──────────────────────────────────────┐
│ Pro+ · 1,240 days · last seen 1d                │
│ 1 ticket in 90d · NPS 9 · tags: vip, advocate   │
│ ▸ Last 3: feature q, integration q, billing q   │
└─────────────────────────────────────────────────┘
```

### Empty state (no ticket open)

Chip is hidden entirely.

### Loading state

```
┌─[ ⌛ Loading customer… ]────────────────────────┐
│ Fetching from Intercom…                         │
└─────────────────────────────────────────────────┘
```

---

## M3 — Suggestions review (already exists, will populate after C1)

```
┌─ Suggestions pending (3) ─────────────────────────────┐
│ Refund request — within standard window               │
│   Refined instruction proposal:                       │
│   "Confirm plan, charge date, AND refund window       │
│    eligibility before quoting an amount."             │
│   Reason: manager added eligibility check 3x in 30d   │
│   [ Accept ]  [ Reject ]  [ Defer ]                   │
└───────────────────────────────────────────────────────┘
```

### After Accept (preview before apply, per C2 decision)

```
┌─ Apply this change? ──────────────────────────────────┐
│ Entry: Refund request — within standard window        │
│                                                       │
│ Current instruction:                                  │
│   Confirm plan and charge date before quoting any     │
│   refund amount.                                      │
│                                                       │
│ New instruction:                                      │
│   Confirm plan, charge date, AND refund window        │
│   eligibility before quoting an amount.               │
│                                                       │
│ [ Apply ]  [ Cancel ]                                 │
└───────────────────────────────────────────────────────┘
```

### Split-entry case (manual handoff)

```
┌─ Suggestion needs manual review ──────────────────────┐
│ Proposal: split into a new entry                      │
│ Reason: manager handles "VAT-inclusive" cases         │
│ differently from refund-window cases.                 │
│                                                       │
│ [ Open as new entry form ]  [ Cancel ]                │
└───────────────────────────────────────────────────────┘
```

---

## M4 — Outreach mode (F3)

```
┌─ Compose ──┬─ Outreach ─┐──────────────────────────────┐
│            │            │                              │
│ Customer:  [ jane@acme.com ▾ ]   ( Search recent ▸ )   │
│                                                        │
│ Template:  ( ◉ Renewal 30d   ○ Win-back 60d            │
│              ○ Post-resolution check-in                │
│              ○ Cross-product cross-sell                │
│              ○ Bug cluster — known issue )             │
│                                                        │
│ Notes:     [ Optional context… ]                       │
│                                                        │
│            [ Generate outreach ▸ ]                     │
└────────────────────────────────────────────────────────┘
```

### Output (single message, no Version A/B)

```
REASON:
  This customer's renewal is in 28 days. Account healthy,
  no open tickets, NPS 8. Lead with shipped improvements
  in their Pro feature set, not pricing.

OUTREACH MESSAGE:
  Hi Jane,

  Quick check-in as your subscription renews next month —
  I wanted to share what's new in OptinMonster since you
  signed up…

  [ Copy ]  [ Insert ]
```

---

## M5 — Options page after bug fixes

```
┌─ API Keys ────────────────────────────────────────────┐
│ Gemini  [ ********** ]                                │
│ Claude  [ ********** ]                                │
│ OpenAI  [ ********** ]                                │
│                            [ Save ] [ Saved ✓ ]       │
└───────────────────────────────────────────────────────┘
┌─ Intercom ────────────────────────────────────────────┐
│ API key   [ ********************          ]           │
│                            [ Test connection ]        │
│ Status: ✓ Connected · 1,247 customers in workspace    │
└───────────────────────────────────────────────────────┘
┌─ Library backup ──────────────────────────────────────┐
│ [ Export library + drafts ]                           │
│ [ Import from file… ]                                 │
│ [ Reset library to seeds ]                            │
│ Last action: Imported 24 entries · 2 minutes ago      │
└───────────────────────────────────────────────────────┘
```

### Toast (after import success)

```
┌─ ✓ Imported 24 entries ────────────────────[ × ]──┐
└───────────────────────────────────────────────────┘
```

### Toast (after import failure)

```
┌─ ⚠ Import failed: entry 3 missing scenario_instruction ─[ × ]──┐
└────────────────────────────────────────────────────────────────┘
```

---

## Review notes

When you sign off on these mockups, I'll move on to the test plan ([05-TESTS.md](05-TESTS.md)) and the actual implementation order from [02-BUGS.md](02-BUGS.md).

If a mockup needs a change, edit this file and note the change in the same commit. The doc is the source of truth, not memory.
