// Generates the self-contained weekly digest HTML. No external assets, no
// scripts, all CSS inlined. The file is meant to be downloaded, opened
// locally, or attached to Slack / email.

import { bar, line, pie, stackedBar, counter } from "./charts.js";

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const STYLES = `
* { box-sizing: border-box; }
body { font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; color: #1f2328; background: #f6f7f9; margin: 0; padding: 32px 16px; }
.report { max-width: 920px; margin: 0 auto; }
.report-header { padding-bottom: 16px; border-bottom: 1px solid #e3e5e8; margin-bottom: 24px; }
.report-title { font-size: 22px; font-weight: 700; margin: 0 0 6px; }
.report-meta { color: #6b7280; font-size: 13px; }
.section { background: #fff; border: 1px solid #e3e5e8; border-radius: 8px; padding: 18px 20px; margin-bottom: 18px; }
.section-tag { display: inline-block; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.6px; color: #6b7280; margin-bottom: 4px; }
.section-title { font-size: 16px; font-weight: 700; margin: 0 0 14px; }
h3 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; font-weight: 600; margin: 18px 0 8px; }
.counter-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin: 8px 0 14px; }
.counter { background: #f9fafb; border: 1px solid #e3e5e8; border-radius: 6px; padding: 10px 12px; }
.counter-value { font-size: 22px; font-weight: 700; color: #111827; line-height: 1.1; }
.counter-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; margin-top: 4px; }
.counter-footnote { font-size: 11px; color: #9ca3af; margin-top: 4px; font-style: italic; }
.empty-chart { color: #9ca3af; font-size: 12px; padding: 18px 0; text-align: center; }
.legend { margin-top: 8px; }
.legend-row { display: flex; align-items: center; font-size: 12px; padding: 2px 0; gap: 6px; color: #1f2328; }
.legend-num { color: #6b7280; margin-left: auto; font-variant-numeric: tabular-nums; }
.legend-swatch { width: 10px; height: 10px; border-radius: 2px; flex-shrink: 0; }
.legend-line { font-size: 11px; color: #4b5563; margin-top: 6px; line-height: 1.6; }
.legend-inline { white-space: nowrap; margin-right: 8px; }
.pie-wrap { display: flex; gap: 18px; align-items: flex-start; flex-wrap: wrap; }
.pie-wrap .legend { flex: 1; min-width: 220px; }
.stacked-wrap { margin: 6px 0; }
.friction-card { border: 1px solid #e3e5e8; border-radius: 6px; padding: 10px 12px; margin-bottom: 8px; background: #fff; }
.friction-card.rank-1 { border-left: 4px solid #dc2626; }
.friction-card.rank-2 { border-left: 4px solid #d97706; }
.friction-card.rank-3 { border-left: 4px solid #6b7280; }
.friction-rank { font-size: 10px; text-transform: uppercase; letter-spacing: 0.6px; color: #6b7280; font-weight: 600; }
.friction-name { font-size: 14px; font-weight: 600; margin: 2px 0 6px; }
.friction-stats { font-size: 12px; color: #4b5563; }
.friction-stats .stat-pill { display: inline-block; padding: 2px 7px; background: #f3f4f6; border-radius: 10px; margin-right: 4px; font-size: 11px; color: #374151; }
.friction-quote { font-size: 12px; color: #6b7280; font-style: italic; margin-top: 6px; padding-left: 10px; border-left: 2px solid #e5e7eb; }
.friction-evidence { font-size: 11px; color: #9ca3af; margin-top: 4px; }
.oi-card { background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 6px; padding: 12px 14px; }
.oi-verdict { display: inline-block; padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 6px; }
.oi-verdict.yes { background: #dcfce7; color: #166534; }
.oi-verdict.no { background: #fee2e2; color: #991b1b; }
.oi-verdict.conditional { background: #fef3c7; color: #92400e; }
.oi-row { font-size: 12px; color: #4b5563; margin-top: 4px; }
.oi-row strong { color: #1f2328; font-weight: 600; }
.timewaster-card { background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 12px 14px; }
.timewaster-saved-reply { margin-top: 8px; padding: 8px 10px; background: #fff; border: 1px dashed #fde68a; border-radius: 4px; font-size: 12px; line-height: 1.5; white-space: pre-wrap; color: #1f2328; }
.kg-list { padding-left: 18px; margin: 6px 0 0; font-size: 12px; color: #4b5563; }
.kg-list li { margin: 4px 0; }
.caveats { font-size: 11px; color: #6b7280; margin-top: 14px; padding-top: 12px; border-top: 1px dashed #e5e7eb; }
.caveats ul { padding-left: 18px; margin: 4px 0; }
.ask { background: #fff7ed; border-left: 4px solid #ea580c; padding: 10px 14px; border-radius: 4px; font-size: 13px; }
.ask strong { color: #9a3412; }
.no-data { color: #9ca3af; font-style: italic; font-size: 12px; }
@media print {
  body { background: #fff; padding: 0; }
  .section { page-break-inside: avoid; }
}
`;

function header({ weekStart, weekEnd, agent, generatedAt }) {
  const range = weekStart && weekEnd ? `${weekStart} — ${weekEnd}` : "Week";
  const who = agent ? ` · ${agent}` : "";
  const stamp = generatedAt ? `Generated ${new Date(generatedAt).toLocaleString()}` : "";
  return `
    <div class="report-header">
      <div class="report-title">Weekly Support Insights</div>
      <div class="report-meta">${escapeHtml(range)}${escapeHtml(who)}${stamp ? " · " + escapeHtml(stamp) : ""}</div>
    </div>`;
}

function sectionPersonalWpsa(json) {
  if (!json) {
    return `<div class="section"><span class="section-tag">Section 1</span><h2 class="section-title">Personal stats from WPSA</h2><div class="no-data">No personal WPSA JSON provided.</div></div>`;
  }
  const t = json.totals;
  const happiness = t.happiness || {};
  const happinessTotal = (happiness.good || 0) + (happiness.okay || 0) + (happiness.bad || 0);
  const counters = [
    counter({ label: "Conversations", value: t.conversations }),
    counter({ label: "Replies", value: t.replies })
  ];
  if (happinessTotal > 0) {
    counters.push(counter({
      label: "Happiness",
      value: `${happiness.good || 0} good · ${happiness.bad || 0} bad`,
      footnote: `n=${happinessTotal}`
    }));
  }
  const pieSlices = (json.categories || []).map((c) => ({ label: c.name, value: c.conversations }));
  return `
    <div class="section">
      <span class="section-tag">Section 1</span>
      <h2 class="section-title">My personal stats from WPSA</h2>
      <div class="counter-row">${counters.join("")}</div>
      <h3>Categories handled</h3>
      ${pie(pieSlices)}
    </div>`;
}

function sectionAuditMetrics(metrics) {
  if (!metrics) return "";
  const lib = metrics.library || {};
  const sug = metrics.suggestions || {};
  const ctr = metrics.suggestionCtr || {};
  const ctx = metrics.customerContext || {};
  const counters = [
    counter({ label: "Library size", value: lib.total ?? 0,
              footnote: lib.addedThisWeek ? `+${lib.addedThisWeek} this week` : "no new entries" }),
    counter({ label: "Refined entries", value: lib.rewritesAbsorbedAllTime ?? 0,
              footnote: "rewrites absorbed (all time)" }),
    counter({ label: "Suggestions resolved this week",
              value: sug.totalResolvedThisWeek ?? 0,
              footnote: `${sug.appliedThisWeek || 0} applied · ${sug.rejectedThisWeek || 0} rejected · ${sug.deferredThisWeek || 0} deferred` }),
    counter({ label: "Pending review queue", value: sug.pending ?? 0 }),
    counter({ label: "Suggestion strip CTR",
              value: ctr.ratePercent != null ? `${ctr.ratePercent}%` : "—",
              footnote: ctr.total > 0 ? `${ctr.clicked}/${ctr.total} impressions` : "no impressions yet" }),
    counter({ label: "Customer-context coverage",
              value: ctx.ratePercent != null ? `${ctx.ratePercent}%` : "—",
              footnote: ctx.total > 0 ? `${ctx.withContext}/${ctx.total} replies enriched` : "no compose drafts this week" }),
    counter({ label: "Ready-to-Send rate",
              value: metrics.readyToSend != null ? `${metrics.readyToSend}%` : "—",
              footnote: "personal review pattern" })
  ];
  const series = (metrics.librarySeries || []).map((p) => ({ x: p.x, y: p.y }));
  const sugItems = [
    { label: "Applied", value: sug.appliedThisWeek || 0, color: "#16a34a" },
    { label: "Rejected", value: sug.rejectedThisWeek || 0, color: "#dc2626" },
    { label: "Deferred", value: sug.deferredThisWeek || 0, color: "#6b7280" }
  ];
  return `
    <div class="section">
      <span class="section-tag">Section 2</span>
      <h2 class="section-title">How the AI loop is helping me</h2>
      <div class="counter-row">${counters.join("")}</div>
      <h3>Library size — last ${metrics.windowDays || 7} days</h3>
      ${line(series)}
      <h3>Suggestions resolved this week</h3>
      ${stackedBar(sugItems)}
    </div>`;
}

function frictionCard(item) {
  const rankClass = item.rank === 1 ? "rank-1" : item.rank === 2 ? "rank-2" : "rank-3";
  const pills = [];
  if (item.sentiment) pills.push(`<span class="stat-pill">${escapeHtml(item.sentiment)}</span>`);
  if (item.rootCause) pills.push(`<span class="stat-pill">${escapeHtml(item.rootCause.replace(/_/g, " "))}</span>`);
  pills.push(`<span class="stat-pill">${escapeHtml(item.conversations)} convos</span>`);
  if (item.messages) pills.push(`<span class="stat-pill">${escapeHtml(item.messages)} msgs</span>`);
  const evidence = item.evidenceTicketIds?.length
    ? `<div class="friction-evidence">Evidence: #${item.evidenceTicketIds.map(escapeHtml).join(", #")}</div>`
    : "";
  const quote = item.representativeQuote
    ? `<div class="friction-quote">"${escapeHtml(item.representativeQuote)}"</div>`
    : "";
  return `
    <div class="friction-card ${rankClass}">
      <div class="friction-rank">Rank #${escapeHtml(item.rank ?? "?")}</div>
      <div class="friction-name">${escapeHtml(item.name)}</div>
      <div class="friction-stats">${pills.join(" ")}</div>
      ${quote}
      ${evidence}
    </div>`;
}

function oiCard(oi) {
  if (!oi) return "";
  const verdictClass = oi.verdict || "conditional";
  const condition = oi.condition ? `<div class="oi-row"><strong>Condition:</strong> ${escapeHtml(oi.condition)}</div>` : "";
  const hours = oi.outcomeHoursSavedPerWeek != null ? `${oi.outcomeHoursSavedPerWeek} hours/week saved` : "outcome estimate not provided";
  return `
    <div class="oi-card">
      <span class="oi-verdict ${verdictClass}">${escapeHtml((oi.verdict || "conditional").toUpperCase())}</span>
      <div class="oi-row"><strong>Friction:</strong> ${escapeHtml(oi.frictionPoint || "—")}</div>
      <div class="oi-row"><strong>Outcome:</strong> ${escapeHtml(hours)}</div>
      <div class="oi-row"><strong>Input effort:</strong> ${escapeHtml(oi.inputEffort || "—")}</div>
      ${condition}
      ${oi.rationale ? `<div class="oi-row" style="margin-top:6px"><em>${escapeHtml(oi.rationale)}</em></div>` : ""}
    </div>`;
}

function timeWasterCard(tw) {
  if (!tw) return "";
  const cat = tw.category ? `<span class="stat-pill">${escapeHtml(tw.category.replace(/_/g, " "))}</span>` : "";
  return `
    <div class="timewaster-card">
      <div class="friction-rank">Time-waster${tw.occurrences ? ` · ${escapeHtml(tw.occurrences)} occurrences` : ""}</div>
      <div class="friction-name">${escapeHtml(tw.topic || "—")} ${cat}</div>
      ${tw.savedReplyDraft ? `<div class="timewaster-saved-reply">${escapeHtml(tw.savedReplyDraft)}</div>` : ""}
    </div>`;
}

function sectionTeamWpsa(json) {
  if (!json) {
    return `<div class="section"><span class="section-tag">Section 3</span><h2 class="section-title">Customer insights — what the inbox is saying</h2><div class="no-data">No team WPSA JSON provided.</div></div>`;
  }
  const cats = (json.categories || []).map((c) => ({ label: c.name, value: c.conversations }));
  const fb = (json.frictionLeaderboard || []).map(frictionCard).join("");
  const kg = (json.knowledgeGaps || []).length
    ? `<ul class="kg-list">${json.knowledgeGaps.map((g) => `<li><strong>${escapeHtml(g.topic)}</strong>${g.ticketCount != null ? ` (${escapeHtml(g.ticketCount)})` : ""} — ${escapeHtml(g.recommendation)}</li>`).join("")}</ul>`
    : `<div class="no-data">None flagged this week.</div>`;
  const caveats = (json.caveats || []).length
    ? `<div class="caveats"><strong>Caveats from the analyser:</strong><ul>${json.caveats.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ul></div>`
    : "";
  return `
    <div class="section">
      <span class="section-tag">Section 3</span>
      <h2 class="section-title">Customer insights — what the inbox is saying</h2>
      <div class="counter-row">
        ${counter({ label: "Total conversations", value: json.totals.conversations })}
        ${counter({ label: "Total replies", value: json.totals.replies })}
      </div>
      <h3>Categories</h3>
      ${pie(cats)}
      <h3>Friction leaderboard</h3>
      ${fb || `<div class="no-data">No friction items reported.</div>`}
      <h3>O/I verdict</h3>
      ${oiCard(json.oiVerdict) || `<div class="no-data">No O/I verdict.</div>`}
      <h3>Time-waster</h3>
      ${timeWasterCard(json.timeWaster) || `<div class="no-data">No time-waster surfaced.</div>`}
      <h3>Knowledge gaps</h3>
      ${kg}
      ${caveats}
    </div>`;
}

function sectionAsk(askText) {
  if (!askText || !askText.trim()) return "";
  return `
    <div class="section">
      <span class="section-tag">Section 4</span>
      <h2 class="section-title">This week's ask</h2>
      <div class="ask"><strong>Ask:</strong> ${escapeHtml(askText.trim())}</div>
    </div>`;
}

// Public API.
//   buildReportHtml({ personalWpsa, teamWpsa, audit, ask })
// All inputs optional except at least one of personalWpsa / teamWpsa / audit.
export function buildReportHtml({ personalWpsa, teamWpsa, audit, ask } = {}) {
  const meta = teamWpsa?.meta || personalWpsa?.meta || {};
  const headerData = {
    weekStart: meta.weekStart,
    weekEnd: meta.weekEnd,
    agent: personalWpsa?.meta?.agent || meta.agent,
    generatedAt: audit?.generatedAt || new Date().toISOString()
  };
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8" />
<title>Weekly Support Insights — ${escapeHtml(headerData.weekStart || "")} — ${escapeHtml(headerData.weekEnd || "")}</title>
<style>${STYLES}</style>
</head><body>
<div class="report">
  ${header(headerData)}
  ${sectionPersonalWpsa(personalWpsa)}
  ${sectionAuditMetrics(audit)}
  ${sectionTeamWpsa(teamWpsa)}
  ${sectionAsk(ask)}
</div>
</body></html>`;
}
