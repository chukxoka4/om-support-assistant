// Audit metrics — pure aggregations from draft_log + library_v3.
//
// Powers Section 2 of the weekly digest ("how the AI loop is helping me").
// Pure module: no Chrome APIs, takes data in, returns plain object out.
//
// Two signatures coexist:
//   - Legacy "trailing window": windowDays + now. Still used by the side panel
//     live-metrics tile and any caller that wants "last N days from now".
//   - Range-based: { rangeStart, rangeEnd } as ISO strings or epoch ms. Used by
//     the report so the user can pick arbitrary [from, to] (including back-
//     dated quarterly windows). Counts are split by event timestamp:
//       - generatedInRange    → filtered by draft.ts
//       - sentInRange         → filtered by outcome_at, outcome ∈ sent | manager_approved
//       - rewrittenInRange    → filtered by outcome_at, outcome === managerial_rewrite
//     Drafts without an outcome_at simply don't appear in the outcome-bucket
//     counts (correct — we don't know when they transitioned). Their generation
//     is still counted in generatedInRange via ts.

const DAY_MS = 24 * 60 * 60 * 1000;

function toMs(v) {
  if (v == null) return NaN;
  if (typeof v === "number") return v;
  return new Date(v).getTime();
}

function startOfDayMs(ts) {
  const d = new Date(ts);
  // UTC-anchored bucketing: ranges and series are derived from ISO date inputs
  // (yyyy-mm-dd), which have no timezone semantics. Using UTC prevents off-by-
  // one-day artefacts when the host machine isn't on UTC.
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

function isoDay(ts) {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function inRange(ts, rangeStart, rangeEnd) {
  const ms = toMs(ts);
  if (Number.isNaN(ms)) return false;
  return ms >= toMs(rangeStart) && ms <= toMs(rangeEnd);
}

function isCompose(d) {
  return !d?.action_type || d.action_type === "compose";
}

// ---------- legacy trailing-window helpers (still used by live tile) ----------

// Drafts in the last `windowDays` days, compose-only (excludes quick transforms).
export function recentComposeDrafts(drafts, windowDays = 7, now = Date.now()) {
  const cutoff = now - windowDays * DAY_MS;
  return (drafts || []).filter((d) => {
    if (!d?.ts) return false;
    if (!isCompose(d)) return false;
    return new Date(d.ts).getTime() >= cutoff;
  });
}

// Ready-to-Send: (sent + manager_approved) / drafts-with-any-outcome.
export function readyToSendRate(drafts) {
  const withOutcome = (drafts || []).filter((d) => d?.outcome);
  if (!withOutcome.length) return null;
  const ready = withOutcome.filter((d) =>
    d.outcome === "sent" || d.outcome === "manager_approved"
  ).length;
  return Math.round((ready / withOutcome.length) * 100);
}

// Suggestion strip CTR: of the drafts that had impressions logged, how many
// converted to a click on a suggestion before Generate?
export function suggestionCtr(drafts) {
  const withImpressions = (drafts || []).filter((d) => {
    const log = d?.suggestion_log;
    return log && Array.isArray(log.impression_ids) && log.impression_ids.length;
  });
  const clicked = withImpressions.filter((d) => d.suggestion_log.clicked_id).length;
  return {
    total: withImpressions.length,
    clicked,
    ratePercent: withImpressions.length > 0
      ? Math.round((clicked / withImpressions.length) * 100)
      : null
  };
}

// % of drafts where customer_context_used is true.
export function customerContextCoverage(drafts) {
  if (!drafts?.length) return { total: 0, withContext: 0, ratePercent: null };
  const withContext = drafts.filter((d) => d?.customer_context_used === true).length;
  return {
    total: drafts.length,
    withContext,
    ratePercent: Math.round((withContext / drafts.length) * 100)
  };
}

export function suggestionResolutions(library, windowDays = 7, now = Date.now()) {
  const cutoff = now - windowDays * DAY_MS;
  const all = (library || []).flatMap((e) => e.pending_suggestions || []);
  const recent = all.filter((s) => {
    if (!s?.resolved_at) return false;
    return new Date(s.resolved_at).getTime() >= cutoff;
  });
  const tally = (status) => recent.filter((s) => s.status === status).length;
  return {
    pending: all.filter((s) => s.status === "pending").length,
    needsManual: all.filter((s) => s.status === "needs_manual").length,
    appliedThisWeek: tally("applied"),
    rejectedThisWeek: tally("rejected"),
    deferredThisWeek: tally("deferred"),
    totalResolvedThisWeek: tally("applied") + tally("rejected") + tally("deferred")
  };
}

export function libraryState(library, drafts, windowDays = 7, now = Date.now()) {
  const cutoff = now - windowDays * DAY_MS;
  const newThisWeek = (library || []).filter((e) => {
    if (!e?.created_at) return false;
    return new Date(e.created_at).getTime() >= cutoff;
  });
  const sumRewrites = (library || [])
    .reduce((s, e) => s + (e?.score?.rewrites_absorbed || 0), 0);
  const refinedThisWeek = (library || []).filter((e) => {
    if (!e?.last_used_at) return false;
    return new Date(e.last_used_at).getTime() >= cutoff &&
           (e.score?.rewrites_absorbed || 0) > 0;
  }).length;
  return {
    total: (library || []).length,
    addedThisWeek: newThisWeek.length,
    seedCount: (library || []).filter((e) => e.source === "seed").length,
    generatedCount: (library || []).filter((e) => e.source === "generated").length,
    refinedCountAllTime: refinedThisWeek > 0
      ? (library || []).filter((e) => (e.score?.rewrites_absorbed || 0) > 0).length
      : 0,
    rewritesAbsorbedAllTime: sumRewrites
  };
}

export function librarySizeSeries(library, days = 7, now = Date.now()) {
  const today = startOfDayMs(now);
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const dayStart = today - i * DAY_MS;
    const dayEnd = dayStart + DAY_MS;
    const count = (library || []).filter((e) => {
      if (!e?.created_at) return true;
      return new Date(e.created_at).getTime() < dayEnd;
    }).length;
    out.push({ x: isoDay(dayStart).slice(5), y: count });
  }
  return out;
}

// ---------- range-based helpers (used by the report) ----------

// Drafts generated inside [rangeStart, rangeEnd], compose-only, by `ts`.
export function generatedInRange(drafts, rangeStart, rangeEnd) {
  return (drafts || []).filter((d) => isCompose(d) && inRange(d?.ts, rangeStart, rangeEnd));
}

// Drafts whose outcome transitioned into sent / manager_approved inside the
// range, by `outcome_at`. Drafts without outcome_at are excluded (we don't
// know when they happened).
export function sentInRange(drafts, rangeStart, rangeEnd) {
  return (drafts || []).filter((d) => {
    if (!isCompose(d)) return false;
    if (d?.outcome !== "sent" && d?.outcome !== "manager_approved") return false;
    return inRange(d?.outcome_at, rangeStart, rangeEnd);
  });
}

// Drafts rewritten by a manager inside the range, by `outcome_at`.
export function rewrittenInRange(drafts, rangeStart, rangeEnd) {
  return (drafts || []).filter((d) => {
    if (!isCompose(d)) return false;
    if (d?.outcome !== "managerial_rewrite") return false;
    return inRange(d?.outcome_at, rangeStart, rangeEnd);
  });
}

// Suggestion review queue: pending all-time; resolutions inside the range by
// `resolved_at`.
export function suggestionResolutionsInRange(library, rangeStart, rangeEnd) {
  const all = (library || []).flatMap((e) => e.pending_suggestions || []);
  const recent = all.filter((s) => inRange(s?.resolved_at, rangeStart, rangeEnd));
  const tally = (status) => recent.filter((s) => s.status === status).length;
  return {
    pending: all.filter((s) => s.status === "pending").length,
    needsManual: all.filter((s) => s.status === "needs_manual").length,
    appliedInRange: tally("applied"),
    rejectedInRange: tally("rejected"),
    deferredInRange: tally("deferred"),
    totalResolvedInRange: tally("applied") + tally("rejected") + tally("deferred")
  };
}

// Library state with "added in this range" by `created_at`.
export function libraryStateInRange(library, rangeStart, rangeEnd) {
  const list = library || [];
  const addedInRange = list.filter((e) => inRange(e?.created_at, rangeStart, rangeEnd));
  const sumRewrites = list.reduce((s, e) => s + (e?.score?.rewrites_absorbed || 0), 0);
  return {
    total: list.length,
    addedInRange: addedInRange.length,
    seedCount: list.filter((e) => e.source === "seed").length,
    generatedCount: list.filter((e) => e.source === "generated").length,
    rewritesAbsorbedAllTime: sumRewrites
  };
}

// One point per day across the range. Counts library entries whose
// `created_at` is on or before each day.
export function librarySizeSeriesInRange(library, rangeStart, rangeEnd) {
  const startDay = startOfDayMs(toMs(rangeStart));
  const endDay = startOfDayMs(toMs(rangeEnd));
  const out = [];
  for (let day = startDay; day <= endDay; day += DAY_MS) {
    const dayEnd = day + DAY_MS;
    const count = (library || []).filter((e) => {
      if (!e?.created_at) return true;
      return new Date(e.created_at).getTime() < dayEnd;
    }).length;
    out.push({ x: isoDay(day).slice(5), y: count });
  }
  return out;
}

// Daily series of generated / sent / rewritten counts across the range.
// Useful for a stacked bar in the report.
export function activitySeriesInRange(drafts, rangeStart, rangeEnd) {
  const startDay = startOfDayMs(toMs(rangeStart));
  const endDay = startOfDayMs(toMs(rangeEnd));
  const days = [];
  for (let day = startDay; day <= endDay; day += DAY_MS) days.push(day);

  const bucket = (ts) => {
    const ms = toMs(ts);
    if (Number.isNaN(ms)) return -1;
    const ds = startOfDayMs(ms);
    return days.indexOf(ds);
  };

  const out = days.map((day) => ({
    x: isoDay(day).slice(5),
    generated: 0,
    sent: 0,
    rewritten: 0
  }));

  for (const d of drafts || []) {
    if (!isCompose(d)) continue;
    const gi = bucket(d?.ts);
    if (gi >= 0) out[gi].generated += 1;
    if (d?.outcome === "sent" || d?.outcome === "manager_approved") {
      const oi = bucket(d?.outcome_at);
      if (oi >= 0) out[oi].sent += 1;
    } else if (d?.outcome === "managerial_rewrite") {
      const oi = bucket(d?.outcome_at);
      if (oi >= 0) out[oi].rewritten += 1;
    }
  }

  return out;
}

// One-shot for the legacy live tile (last N days from now).
export function computeAuditMetrics({ drafts, library, windowDays = 7, now = Date.now() }) {
  const recent = recentComposeDrafts(drafts, windowDays, now);
  return {
    windowDays,
    generatedAt: new Date(now).toISOString(),
    library: libraryState(library, recent, windowDays, now),
    librarySeries: librarySizeSeries(library, windowDays, now),
    suggestions: suggestionResolutions(library, windowDays, now),
    suggestionCtr: suggestionCtr(recent),
    customerContext: customerContextCoverage(recent),
    readyToSend: readyToSendRate(recent),
    composedThisWeek: recent.length
  };
}

// One-shot for the report (arbitrary [rangeStart, rangeEnd]).
//
// `composeDrafts` covers anything authored from compose; outcome buckets are
// split by event timestamp so they don't overlap with `generated`. Counts here
// are independent — a draft generated April 1 and approved April 6 contributes
// to `generated` for the Apr 1 range and to `sent` for the Apr 6 range.
export function computeAuditMetricsForRange({ drafts, library, rangeStart, rangeEnd }) {
  const composeDrafts = (drafts || []).filter(isCompose);
  const generated = generatedInRange(composeDrafts, rangeStart, rangeEnd);
  const sent = sentInRange(composeDrafts, rangeStart, rangeEnd);
  const rewritten = rewrittenInRange(composeDrafts, rangeStart, rangeEnd);

  // Outcome-window context: of drafts that reached an outcome inside the
  // range, what fraction are ready-to-send? Of drafts generated inside the
  // range, what fraction had Intercom context attached?
  const reachedOutcomeInRange = [...sent, ...rewritten];
  const readyToSend = reachedOutcomeInRange.length
    ? Math.round((sent.length / reachedOutcomeInRange.length) * 100)
    : null;

  return {
    rangeStart: new Date(toMs(rangeStart)).toISOString(),
    rangeEnd: new Date(toMs(rangeEnd)).toISOString(),
    generatedAt: new Date().toISOString(),
    library: libraryStateInRange(library, rangeStart, rangeEnd),
    librarySeries: librarySizeSeriesInRange(library, rangeStart, rangeEnd),
    activitySeries: activitySeriesInRange(composeDrafts, rangeStart, rangeEnd),
    suggestions: suggestionResolutionsInRange(library, rangeStart, rangeEnd),
    suggestionCtr: suggestionCtr(generated),
    customerContext: customerContextCoverage(generated),
    readyToSend,
    counts: {
      generated: generated.length,
      sent: sent.length,
      rewritten: rewritten.length,
      reachedOutcome: reachedOutcomeInRange.length
    }
  };
}
