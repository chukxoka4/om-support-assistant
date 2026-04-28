// Slack-friendly markdown digest. Auto-copied to clipboard alongside the
// HTML download. Reader posts this in Slack and attaches the HTML for
// anyone who wants charts.

function pct(n) {
  return n == null ? "—" : `${n}%`;
}

function happinessLine(t) {
  const h = t?.happiness;
  if (!h) return null;
  const total = (h.good || 0) + (h.okay || 0) + (h.bad || 0);
  if (!total) return null;
  return `Happiness: ${h.good || 0} good · ${h.okay || 0} okay · ${h.bad || 0} bad (n=${total})`;
}

export function buildSlackSnippet({ personalWpsa, teamWpsa, audit, ask } = {}) {
  const meta = teamWpsa?.meta || personalWpsa?.meta || {};
  const range = meta.weekStart && meta.weekEnd ? `${meta.weekStart} → ${meta.weekEnd}` : "this week";
  const agent = personalWpsa?.meta?.agent || meta.agent || "";
  const lines = [];
  lines.push(`*Weekly Support Insights — ${range}*${agent ? ` · ${agent}` : ""}`);
  lines.push("");

  // Section 1 — personal WPSA
  if (personalWpsa) {
    lines.push("*1. My week*");
    lines.push(`• ${personalWpsa.totals.conversations} conversations · ${personalWpsa.totals.replies} replies`);
    const hap = happinessLine(personalWpsa.totals);
    if (hap) lines.push(`• ${hap}`);
    if (personalWpsa.categories?.length) {
      const top = personalWpsa.categories.slice(0, 3).map((c) => `${c.name} (${c.conversations})`).join(", ");
      lines.push(`• Top categories: ${top}`);
    }
    lines.push("");
  }

  // Section 2 — audit
  if (audit) {
    lines.push("*2. AI loop progress*");
    const lib = audit.library || {};
    const sug = audit.suggestions || {};
    const ctr = audit.suggestionCtr || {};
    const ctx = audit.customerContext || {};
    lines.push(`• Library: ${lib.total ?? 0} entries${lib.addedThisWeek ? ` (+${lib.addedThisWeek} this week)` : ""}, ${lib.rewritesAbsorbedAllTime ?? 0} rewrites absorbed`);
    lines.push(`• Suggestions: ${sug.totalResolvedThisWeek ?? 0} resolved (${sug.appliedThisWeek || 0} applied · ${sug.rejectedThisWeek || 0} rejected · ${sug.deferredThisWeek || 0} deferred), ${sug.pending ?? 0} pending`);
    lines.push(`• Suggestion strip CTR: ${pct(ctr.ratePercent)}${ctr.total ? ` (${ctr.clicked}/${ctr.total})` : ""}`);
    lines.push(`• Customer-context coverage: ${pct(ctx.ratePercent)}${ctx.total ? ` (${ctx.withContext}/${ctx.total} replies)` : ""}`);
    lines.push(`• Ready-to-Send rate: ${pct(audit.readyToSend)} _(personal review pattern)_`);
    lines.push("");
  }

  // Section 3 — team / customer insights
  if (teamWpsa) {
    lines.push("*3. What customers are saying*");
    lines.push(`• ${teamWpsa.totals.conversations} conversations · ${teamWpsa.totals.replies} replies`);
    if (teamWpsa.frictionLeaderboard?.length) {
      const top = teamWpsa.frictionLeaderboard[0];
      lines.push(`• #1 friction: *${top.name}* — ${top.conversations} convos${top.messages ? `, ${top.messages} msgs` : ""}${top.sentiment ? ` (${top.sentiment})` : ""}`);
      teamWpsa.frictionLeaderboard.slice(1).forEach((f) => {
        lines.push(`   #${f.rank ?? "?"}: ${f.name} — ${f.conversations} convos`);
      });
    }
    if (teamWpsa.oiVerdict) {
      const oi = teamWpsa.oiVerdict;
      const verdict = (oi.verdict || "").toUpperCase();
      lines.push(`• O/I verdict: *${verdict}* on _${oi.frictionPoint || "—"}_${oi.outcomeHoursSavedPerWeek != null ? ` — ~${oi.outcomeHoursSavedPerWeek}h/week saved` : ""}, input effort: ${oi.inputEffort || "—"}`);
      if (oi.rationale) lines.push(`   _${oi.rationale}_`);
    }
    if (teamWpsa.timeWaster?.topic) {
      const tw = teamWpsa.timeWaster;
      lines.push(`• Time-waster: ${tw.topic}${tw.occurrences ? ` (${tw.occurrences} occurrences)` : ""} — saved-reply drafted`);
    }
    if (teamWpsa.knowledgeGaps?.length) {
      lines.push(`• Knowledge gaps: ${teamWpsa.knowledgeGaps.map((g) => g.topic).join("; ")}`);
    }
    if (teamWpsa.caveats?.length) {
      lines.push(`_caveats: ${teamWpsa.caveats.join(" · ")}_`);
    }
    lines.push("");
  }

  if (ask && ask.trim()) {
    lines.push(`*Ask:* ${ask.trim()}`);
    lines.push("");
  }

  lines.push("_Full report attached as HTML — click to open in browser._");
  return lines.join("\n");
}
