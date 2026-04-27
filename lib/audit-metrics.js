// Audit metrics — pure aggregations from draft_log + library_v3.
//
// Powers Section 2 of the weekly digest ("how the AI loop is helping me").
// Pure module: no Chrome APIs, takes data in, returns plain object out.
//
// Exported helpers are testable in isolation; computeAuditMetrics is the
// one-shot the side panel calls with raw storage data.

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDayMs(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function isoDay(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Drafts in the last `windowDays` days, compose-only (excludes quick transforms).
export function recentComposeDrafts(drafts, windowDays = 7, now = Date.now()) {
  const cutoff = now - windowDays * DAY_MS;
  return (drafts || []).filter((d) => {
    if (!d?.ts) return false;
    if (d.action_type && d.action_type !== "compose") return false;
    return new Date(d.ts).getTime() >= cutoff;
  });
}

// Ready-to-Send: (sent + manager_approved) / drafts-with-any-outcome.
// "Personal review pattern" — the agent who pre-reviews their own drafts.
// The denominator excludes pending drafts to avoid penalising in-flight work.
export function readyToSendRate(drafts) {
  const withOutcome = (drafts || []).filter((d) => d?.outcome);
  if (!withOutcome.length) return null;
  const ready = withOutcome.filter((d) =>
    d.outcome === "sent" || d.outcome === "manager_approved"
  ).length;
  return Math.round((ready / withOutcome.length) * 100);
}

// Suggestion strip CTR: of the drafts that had impressions logged, how many
// converted to a click on a suggestion before Generate? Returns { total,
// clicked, ratePercent }.
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

// % of drafts where customer_context_used is true (F2 Intercom enrichment).
export function customerContextCoverage(drafts) {
  if (!drafts?.length) return { total: 0, withContext: 0, ratePercent: null };
  const withContext = drafts.filter((d) => d?.customer_context_used === true).length;
  return {
    total: drafts.length,
    withContext,
    ratePercent: Math.round((withContext / drafts.length) * 100)
  };
}

// Suggestion review queue stats — totals across the library, plus how many
// were resolved this week.
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

// Library state + this week's growth.
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

// Library size over the last N days. Returns [{ x: "MM-DD", y: <count> }].
// Computed by counting library entries whose created_at is on or before each day.
export function librarySizeSeries(library, days = 7, now = Date.now()) {
  const today = startOfDayMs(now);
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const dayStart = today - i * DAY_MS;
    const dayEnd = dayStart + DAY_MS;
    const count = (library || []).filter((e) => {
      if (!e?.created_at) return true; // unknown vintage = treat as pre-existing
      return new Date(e.created_at).getTime() < dayEnd;
    }).length;
    out.push({ x: isoDay(dayStart).slice(5), y: count });
  }
  return out;
}

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
