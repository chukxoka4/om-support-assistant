// Validator for the WPSA AI's JSON output. Called by the Audit tab before
// it tries to render. Returns { ok, errors[], normalised }. The normaliser
// fills in missing optional fields with safe defaults so the report
// generator can rely on shape.

const FRICTION_ROOT_CAUSES = ["ui_workflow", "documentation_gap", "known_issue", "product_gap"];
const FRICTION_SENTIMENTS = ["frustrated", "confused", "accepting", "urgent"];
const TIME_WASTER_CATEGORIES = ["product_friction", "process_repetition"];
const OI_VERDICTS = ["yes", "no", "conditional"];
const OI_INPUT_EFFORTS = ["low", "medium", "high", "unknown"];
const OI_GROWTH_LEVERS = ["churn", "reactivations", "upgrades", "cost_reduction", "none"];
const OI_ESCALATION_VERDICTS = ["playbook_only", "escalate", "watch"];
const SCOPES = ["personal", "team"];

function pushIf(arr, cond, msg) { if (cond) arr.push(msg); }

export function parseWpsaJson(rawText) {
  const trimmed = (rawText || "").trim();
  if (!trimmed) return { ok: false, errors: ["empty input"], normalised: null };
  let parsed;
  try {
    // Tolerate markdown fences or stray prose around the JSON object.
    const match = trimmed.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(match ? match[0] : trimmed);
  } catch (e) {
    return { ok: false, errors: [`not valid JSON: ${e.message}`], normalised: null };
  }
  return validateWpsaShape(parsed);
}

export function validateWpsaShape(payload) {
  const errors = [];
  if (!payload || typeof payload !== "object") {
    return { ok: false, errors: ["payload is not an object"], normalised: null };
  }

  // meta — required
  const meta = payload.meta || {};
  pushIf(errors, !meta.weekStart, "meta.weekStart missing");
  pushIf(errors, !meta.weekEnd, "meta.weekEnd missing");
  if (meta.scope && !SCOPES.includes(meta.scope)) {
    errors.push(`meta.scope must be one of ${SCOPES.join(" / ")}`);
  }

  // totals — required
  const totals = payload.totals || {};
  pushIf(errors, typeof totals.conversations !== "number", "totals.conversations missing or not a number");
  pushIf(errors, typeof totals.replies !== "number", "totals.replies missing or not a number");

  // categories — required, ≥1
  const categories = Array.isArray(payload.categories) ? payload.categories : [];
  pushIf(errors, categories.length === 0, "categories array is empty");
  for (const [i, c] of categories.entries()) {
    if (typeof c?.name !== "string") errors.push(`categories[${i}].name not a string`);
    if (typeof c?.conversations !== "number") errors.push(`categories[${i}].conversations not a number`);
  }

  // frictionLeaderboard — required, 1–3
  const friction = Array.isArray(payload.frictionLeaderboard) ? payload.frictionLeaderboard : [];
  pushIf(errors, friction.length < 1, "frictionLeaderboard must have at least 1 item");
  pushIf(errors, friction.length > 3, "frictionLeaderboard has more than 3 items");
  for (const [i, f] of friction.entries()) {
    if (typeof f?.name !== "string") errors.push(`friction[${i}].name not a string`);
    if (typeof f?.conversations !== "number") errors.push(`friction[${i}].conversations not a number`);
    if (f?.sentiment && !FRICTION_SENTIMENTS.includes(f.sentiment)) {
      errors.push(`friction[${i}].sentiment "${f.sentiment}" not recognised`);
    }
    if (f?.rootCause && !FRICTION_ROOT_CAUSES.includes(f.rootCause)) {
      errors.push(`friction[${i}].rootCause "${f.rootCause}" not recognised`);
    }
  }

  // timeWaster — optional but if present check shape
  const timeWaster = payload.timeWaster;
  if (timeWaster && typeof timeWaster === "object") {
    if (timeWaster.category && !TIME_WASTER_CATEGORIES.includes(timeWaster.category)) {
      errors.push(`timeWaster.category "${timeWaster.category}" not recognised`);
    }
  }

  // oiVerdict — optional but check enums when present
  const oi = payload.oiVerdict;
  if (oi && typeof oi === "object") {
    if (oi.verdict && !OI_VERDICTS.includes(oi.verdict)) {
      errors.push(`oiVerdict.verdict "${oi.verdict}" not recognised`);
    }
    if (oi.inputEffort && !OI_INPUT_EFFORTS.includes(oi.inputEffort)) {
      errors.push(`oiVerdict.inputEffort "${oi.inputEffort}" not recognised`);
    }
    if (oi.primaryGrowthLever && !OI_GROWTH_LEVERS.includes(oi.primaryGrowthLever)) {
      errors.push(`oiVerdict.primaryGrowthLever "${oi.primaryGrowthLever}" not recognised`);
    }
    if (oi.escalationVerdict && !OI_ESCALATION_VERDICTS.includes(oi.escalationVerdict)) {
      errors.push(`oiVerdict.escalationVerdict "${oi.escalationVerdict}" not recognised`);
    }
  }

  if (errors.length) return { ok: false, errors, normalised: null };

  // Normalise: fill optional arrays/objects with safe empties so the
  // renderer doesn't have to null-check.
  const normalised = {
    meta: {
      weekStart: meta.weekStart,
      weekEnd: meta.weekEnd,
      agent: meta.agent || null,
      product: meta.product || null,
      scope: meta.scope || null
    },
    totals: {
      conversations: totals.conversations,
      replies: totals.replies,
      happiness: totals.happiness && typeof totals.happiness === "object"
        ? {
            good: typeof totals.happiness.good === "number" ? totals.happiness.good : null,
            okay: typeof totals.happiness.okay === "number" ? totals.happiness.okay : null,
            bad: typeof totals.happiness.bad === "number" ? totals.happiness.bad : null
          }
        : null
    },
    categories: categories.map((c) => ({
      name: c.name,
      conversations: c.conversations,
      percent: typeof c.percent === "number" ? c.percent : null
    })),
    frictionLeaderboard: friction.map((f) => ({
      rank: typeof f.rank === "number" ? f.rank : null,
      name: f.name,
      conversations: f.conversations,
      messages: typeof f.messages === "number" ? f.messages : null,
      sentiment: f.sentiment || null,
      rootCause: f.rootCause || null,
      representativeQuote: f.representativeQuote || null,
      evidenceTicketIds: Array.isArray(f.evidenceTicketIds) ? f.evidenceTicketIds : []
    })),
    timeWaster: timeWaster && typeof timeWaster === "object"
      ? {
          topic: timeWaster.topic || null,
          occurrences: typeof timeWaster.occurrences === "number" ? timeWaster.occurrences : null,
          category: timeWaster.category || null,
          savedReplyDraft: timeWaster.savedReplyDraft || null
        }
      : null,
    oiVerdict: oi && typeof oi === "object"
      ? {
          frictionPoint: oi.frictionPoint || null,
          primaryGrowthLever: oi.primaryGrowthLever || null,
          mveBootstrap: oi.mveBootstrap || null,
          escalationVerdict: oi.escalationVerdict || null,
          outcomeHoursSavedPerWeek: typeof oi.outcomeHoursSavedPerWeek === "number"
            ? oi.outcomeHoursSavedPerWeek : null,
          inputEffort: oi.inputEffort || null,
          verdict: oi.verdict || null,
          condition: oi.condition || null,
          rationale: oi.rationale || null
        }
      : null,
    knowledgeGaps: Array.isArray(payload.knowledgeGaps)
      ? payload.knowledgeGaps.map((g) => ({
          topic: g?.topic || "",
          ticketCount: typeof g?.ticketCount === "number" ? g.ticketCount : null,
          recommendation: g?.recommendation || ""
        }))
      : [],
    caveats: Array.isArray(payload.caveats) ? payload.caveats.filter((c) => typeof c === "string") : []
  };
  return { ok: true, errors: [], normalised };
}
