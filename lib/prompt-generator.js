// Pure prompt generator for the WPSA AI ticketing reporter.
//
// Produces the full prompt string for either personal or team scope, with
// dates and agent baked in. Deterministic — same inputs produce byte-
// identical output, so the test suite can pin behaviour and weekly runs
// don't drift due to formatting changes.

const SCOPES = new Set(["personal", "team"]);

function fail(msg) { throw new Error(`prompt-generator: ${msg}`); }

function isIsoDate(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// Defaults to "You" when no agent name is provided. The "Team" label is
// substituted automatically when scope === "team" regardless of agent input.
function resolveAgent(scope, agent) {
  if (scope === "team") return "Team";
  const trimmed = (agent || "").trim();
  return trimmed || "You";
}

export function buildWpsaPrompt({ scope, weekStart, weekEnd, agent } = {}) {
  if (!SCOPES.has(scope)) fail(`scope must be "personal" or "team"`);
  if (!isIsoDate(weekStart)) fail("weekStart must be YYYY-MM-DD");
  if (!isIsoDate(weekEnd)) fail("weekEnd must be YYYY-MM-DD");

  const resolvedAgent = resolveAgent(scope, agent);
  const scopeNoun = scope === "team" ? "across the WHOLE TEAM" : `for ${resolvedAgent}`;

  return `Date Range: ${weekStart} to ${weekEnd}
Scope: ${scope}
Agent label: ${resolvedAgent}

You are analysing OptinMonster support tickets ${scopeNoun}
for the date range above.

Return ONLY valid JSON, exactly matching the schema below.
No prose, no markdown fences, no commentary before or after.

Rules:
- If a value is uncertain or unknown, use null. Do not invent numbers.
- Do not guess engineering visibility you do not have evidence for.
- If sample size is too small for a number to be meaningful, return
  null and add a note in \`caveats\`.
- frictionLeaderboard: exactly 1, 2, or 3 items, ordered by rank.
- categories: order by descending conversations. Should sum to ~100%
  (within rounding).
- evidenceTicketIds: include 2-3 conversation IDs that demonstrate the
  friction.
- caveats: include sample-size warnings, data heuristics (e.g.
  "Ready-to-Send inferred from no internal notes"), and anything else
  that affects how the manager should read this.
- Set meta.scope to "${scope}" and meta.agent to "${resolvedAgent}".
- For oiVerdict, follow our company's Opportunity + Impact framework:
  every escalation must directly influence one of three CS growth
  levers (churn, reactivations, upgrades). If the friction is purely
  operational (e.g. saves support hours but does not move a growth
  lever), set primaryGrowthLever to "cost_reduction" or "none" — do
  not force-fit it into a growth lever it does not belong in.
- For mveBootstrap, answer this question honestly: could the support
  team solve 80% of this friction with a saved-reply / Playbook entry
  / doc snippet, BEFORE asking engineering for a product change?
  Return a one-sentence answer or null if not applicable.
- For escalationVerdict, choose:
    "playbook_only" — the friction is real but support can absorb it
                      with a saved-reply or doc; no product work needed.
    "escalate"      — friction is significant enough to pitch as an
                      O+I project to the product team.
    "watch"         — pattern is interesting but needs another week of
                      data before deciding.

Schema:

{
  "meta": {
    "weekStart": "${weekStart}",
    "weekEnd": "${weekEnd}",
    "agent": "${resolvedAgent}",
    "product": "OptinMonster",
    "scope": "${scope}"
  },
  "totals": {
    "conversations": <int>,
    "replies": <int>,
    "happiness": {
      "good": <int|null>,
      "okay": <int|null>,
      "bad": <int|null>
    }
  },
  "categories": [
    { "name": "<short label, max 30 chars>",
      "conversations": <int>,
      "percent": <0..100> }
  ],
  "frictionLeaderboard": [
    {
      "rank": <1|2|3>,
      "name": "<feature/topic name>",
      "conversations": <int>,
      "messages": <int>,
      "sentiment": "frustrated|confused|accepting|urgent",
      "rootCause": "ui_workflow|documentation_gap|known_issue|product_gap",
      "representativeQuote": "<one anonymised customer quote, max 200 chars>",
      "evidenceTicketIds": ["<id>", "<id>"]
    }
  ],
  "timeWaster": {
    "topic": "<what was typed repeatedly>",
    "occurrences": <int>,
    "category": "product_friction|process_repetition",
    "savedReplyDraft": "<2-3 sentences, ready to paste as a macro>"
  },
  "oiVerdict": {
    "frictionPoint": "<one of the leaderboard names>",
    "primaryGrowthLever": "churn|reactivations|upgrades|cost_reduction|none",
    "mveBootstrap": "<one sentence — bootstrap option before product fix, or null>",
    "escalationVerdict": "playbook_only|escalate|watch",
    "outcomeHoursSavedPerWeek": <float|null>,
    "inputEffort": "low|medium|high|unknown",
    "verdict": "yes|no|conditional",
    "condition": "<text or null>",
    "rationale": "<one sentence>"
  },
  "knowledgeGaps": [
    { "topic": "<area>",
      "ticketCount": <int>,
      "recommendation": "<one sentence>" }
  ],
  "caveats": [
    "<short note about anything that limits confidence in this report>"
  ]
}`;
}

// Convenience: returns the previous Mon → Sun ISO range, given any "today"
// (defaults to now). Sunday-Mon week boundaries match how WPSA shows the
// weekly view.
export function previousMondayToSunday(now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  const dow = d.getDay();
  // Move back to last Sunday (end of previous week).
  const daysSinceLastSunday = dow === 0 ? 7 : dow;
  const lastSunday = new Date(d);
  lastSunday.setDate(d.getDate() - daysSinceLastSunday);
  const lastMonday = new Date(lastSunday);
  lastMonday.setDate(lastSunday.getDate() - 6);
  const fmt = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  return { weekStart: fmt(lastMonday), weekEnd: fmt(lastSunday) };
}
