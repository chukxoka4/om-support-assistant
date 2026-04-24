import { getAllDrafts } from "./storage.js";
import { getAllEntries, getAllPendingSuggestions } from "./library.js";

const DAY = 24 * 60 * 60 * 1000;

export async function computeMetrics(windowDays = 30) {
  const drafts = await getAllDrafts();
  const cutoff = Date.now() - windowDays * DAY;
  const recent = drafts.filter((d) => new Date(d.ts).getTime() >= cutoff);

  const composeDrafts = recent.filter((d) => !d.action_type || d.action_type === "compose");
  const withOutcome = composeDrafts.filter((d) => d.outcome);
  const sentAsIs = composeDrafts.filter((d) => d.outcome === "sent").length;
  const managerApproved = composeDrafts.filter((d) => d.outcome === "manager_approved").length;
  const managerialRewrite = composeDrafts.filter((d) => d.outcome === "managerial_rewrite").length;
  const edited = composeDrafts.filter((d) => d.outcome === "edited").length;
  const rewrote = composeDrafts.filter((d) => d.outcome === "rewrote").length;

  const acceptedAny = sentAsIs + managerApproved + managerialRewrite;
  const readyRate = withOutcome.length ? Math.round((acceptedAny / withOutcome.length) * 100) : null;
  const managerRate = withOutcome.length
    ? Math.round(((managerApproved + managerialRewrite) / withOutcome.length) * 100)
    : null;

  const quickTransforms = recent.filter((d) => d.action_type === "quick-retone" || d.action_type === "quick-translate").length;

  const libraryEntries = await getAllEntries();
  const pendingSuggestions = await getAllPendingSuggestions();

  return {
    windowDays,
    totalDrafts: composeDrafts.length,
    totalWithOutcome: withOutcome.length,
    sentAsIs, managerApproved, managerialRewrite, edited, rewrote,
    readyRate, managerRate,
    quickTransforms,
    libraryCount: libraryEntries.length,
    pendingSuggestionCount: pendingSuggestions.length
  };
}
