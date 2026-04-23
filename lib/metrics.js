// Compute learning-loop metrics from the draft log.

import { getAllDrafts } from "./storage.js";

const DAY = 24 * 60 * 60 * 1000;

export async function computeMetrics(windowDays = 30) {
  const drafts = await getAllDrafts();
  const cutoff = Date.now() - windowDays * DAY;
  const recent = drafts.filter((d) => new Date(d.ts).getTime() >= cutoff);

  const composeDrafts = recent.filter((d) => !d.action_type || d.action_type === "compose");
  const withOutcome = composeDrafts.filter((d) => d.outcome);
  const sentAsIs = composeDrafts.filter((d) => d.outcome === "sent").length;
  const edited = composeDrafts.filter((d) => d.outcome === "edited").length;
  const rewrote = composeDrafts.filter((d) => d.outcome === "rewrote").length;

  const readyRate = withOutcome.length
    ? Math.round((sentAsIs / withOutcome.length) * 100)
    : null;

  const byProduct = {};
  for (const d of composeDrafts) {
    byProduct[d.product] = (byProduct[d.product] || 0) + 1;
  }

  const quickTransforms = recent.filter((d) => d.action_type === "quick-retone" || d.action_type === "quick-translate").length;

  return {
    windowDays,
    totalDrafts: composeDrafts.length,
    totalWithOutcome: withOutcome.length,
    sentAsIs,
    edited,
    rewrote,
    readyRate,
    byProduct,
    quickTransforms,
    totalRecords: recent.length
  };
}
