// Service layer (per ARCHITECTURE.md): wraps lib/intercom-client.js with
// extension-specific concerns — config lookup, session-storage caching,
// chip threshold logic, and a 6–10 line plain-text formatter that compose
// can hand to the LLM.

import { makeIntercomClient } from "./intercom-client.js";
import { getIntercomConfig } from "./storage.js";

const CACHE_KEY = "intercom_snapshot_cache";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes per email

// ---------- threshold logic (pure) ----------

// Classify customer health from the Intercom snapshot. Returns
// { tier, reason } where tier is one of:
//   "vip" | "green" | "yellow" | "red" | "grey"
// and reason is a short human-readable clause naming the rule that fired.
//
// Pivoted from the conversations-based original: OM routes support outside
// Intercom, so conversation counts are effectively always zero for us. The
// new rules lean on subscription state and engagement (last_seen,
// last_email_opened, last_email_clicked) — the signals Intercom actually
// has for our workspace.
//
// Rule precedence: VIP > red > yellow > green > grey.
//
// classifyHealth(snapshot) → { tier, reason }
// (legacy callers can read tier directly; reason is additive.)
export function classifyHealth(snapshot) {
  if (!snapshot || snapshot.found === false) {
    return { tier: "grey", reason: "no Intercom record" };
  }
  const tags = (snapshot.tags || []).map((t) => String(t).toLowerCase());
  if (tags.includes("vip")) return { tier: "vip", reason: "VIP tag" };

  const status = (snapshot.subscriptionStatus || "").toLowerCase();
  const nps = snapshot.npsScore;
  const conv90 = snapshot.conversationsLast90d || 0;
  const lastSeen = snapshot.lastSeenDays;
  const trialEnds = snapshot.trialEndsInDays;
  const lastEmailOpen = snapshot.lastEmailOpenDays;
  const lastEmailClick = snapshot.lastEmailClickDays;

  // Red — strongest signals first.
  if (["cancelled", "canceled", "churned", "past_due"].includes(status)) {
    return { tier: "red", reason: `subscription ${status}` };
  }
  if (tags.includes("churn-risk")) return { tier: "red", reason: "churn-risk tag" };
  if (snapshot.hasHardBounced) return { tier: "red", reason: "email hard-bounced" };
  if (snapshot.unsubscribedFromEmails && typeof lastSeen === "number" && lastSeen > 60) {
    return { tier: "red", reason: "unsubscribed and inactive 60d+" };
  }
  if (conv90 >= 5) return { tier: "red", reason: "5+ conversations in 90d" };
  if (typeof nps === "number" && nps <= 4) return { tier: "red", reason: `low NPS (${nps})` };

  // Yellow — needs watching.
  if (typeof trialEnds === "number" && trialEnds >= 0 && trialEnds <= 7) {
    return { tier: "yellow", reason: `trial ends in ${trialEnds}d` };
  }
  if (tags.includes("trial-extended")) return { tier: "yellow", reason: "trial-extended tag" };
  if (typeof lastSeen === "number" && lastSeen > 30) {
    const noEmailEng = !isFreshEmailEngagement(lastEmailOpen, lastEmailClick, 30);
    if (noEmailEng) return { tier: "yellow", reason: `inactive ${lastSeen}d, no recent email engagement` };
    return { tier: "yellow", reason: `inactive ${lastSeen}d` };
  }
  if (conv90 >= 3) return { tier: "yellow", reason: `${conv90} conversations in 90d` };
  if (typeof nps === "number" && nps >= 5 && nps <= 7) {
    return { tier: "yellow", reason: `mid NPS (${nps})` };
  }

  // Green — confidence signals.
  if (typeof nps === "number" && nps >= 8) {
    return { tier: "green", reason: `high NPS (${nps})` };
  }
  if (status === "active") {
    if (typeof lastSeen === "number" && lastSeen <= 14) {
      return { tier: "green", reason: "active subscription, recently seen" };
    }
    if (isFreshEmailEngagement(lastEmailOpen, lastEmailClick, 30)) {
      return { tier: "green", reason: "active subscription, recent email engagement" };
    }
  }

  return { tier: "grey", reason: "insufficient signal" };
}

function isFreshEmailEngagement(openDays, clickDays, withinDays) {
  if (typeof clickDays === "number" && clickDays <= withinDays) return true;
  if (typeof openDays === "number" && openDays <= withinDays) return true;
  return false;
}

export const HEALTH_LABELS = {
  vip: "VIP",
  green: "Healthy",
  yellow: "At watch",
  red: "At risk",
  grey: "No data"
};

export const HEALTH_DOTS = {
  vip: "🟢",
  green: "🟢",
  yellow: "🟡",
  red: "🔴",
  grey: "⚪"
};

// ---------- compose formatter (pure) ----------
// Returns 8–14 plain-text lines. No JSON, no markdown. Lines are skipped
// when the field is empty rather than rendered with a "—".
export function stringifySnapshot(snapshot) {
  if (!snapshot || snapshot.found === false) {
    return `No Intercom record found for ${snapshot?.email || "this customer"}.`;
  }
  const lines = [];
  lines.push(`Email: ${snapshot.email}`);
  if (snapshot.name) lines.push(`Name: ${snapshot.name}`);

  // Subscription
  const subParts = [];
  if (snapshot.plan) subParts.push(`Plan: ${snapshot.plan}`);
  if (snapshot.subscriptionStatus) subParts.push(`Status: ${snapshot.subscriptionStatus}`);
  if (typeof snapshot.mrr === "number") subParts.push(`MRR: ${snapshot.mrr}`);
  if (typeof snapshot.tenureDays === "number") subParts.push(`Tenure: ${snapshot.tenureDays}d`);
  if (subParts.length) lines.push(subParts.join(" · "));

  if (typeof snapshot.trialEndsInDays === "number") {
    if (snapshot.trialEndsInDays >= 0) lines.push(`Trial ends in: ${snapshot.trialEndsInDays}d`);
    else lines.push(`Trial expired ${Math.abs(snapshot.trialEndsInDays)}d ago`);
  }

  // Engagement
  const engParts = [];
  if (typeof snapshot.lastSeenDays === "number") engParts.push(`Last seen: ${snapshot.lastSeenDays}d ago`);
  if (typeof snapshot.sessionCount === "number") engParts.push(`Sessions: ${snapshot.sessionCount}`);
  if (typeof snapshot.lastEmailOpenDays === "number") engParts.push(`Email opened: ${snapshot.lastEmailOpenDays}d ago`);
  if (typeof snapshot.lastEmailClickDays === "number") engParts.push(`Email clicked: ${snapshot.lastEmailClickDays}d ago`);
  if (engParts.length) lines.push(engParts.join(" · "));

  if (snapshot.unsubscribedFromEmails) lines.push("Unsubscribed from emails: yes");
  if (snapshot.hasHardBounced) lines.push("Email status: hard-bounced");

  // Identity
  if (snapshot.companyName) {
    const seats = typeof snapshot.companySeats === "number" ? ` (${snapshot.companySeats} seats)` : "";
    lines.push(`Company: ${snapshot.companyName}${seats}`);
  }
  if (snapshot.location) lines.push(`Location: ${snapshot.location}`);
  if (snapshot.language) lines.push(`Language: ${snapshot.language}`);
  if ((snapshot.tags || []).length) lines.push(`Tags: ${snapshot.tags.join(", ")}`);

  // Survey
  if (typeof snapshot.npsScore === "number") lines.push(`NPS: ${snapshot.npsScore}`);

  // Conversations only included when actually present (probably empty).
  if ((snapshot.recentSummaries || []).length) {
    const titles = snapshot.recentSummaries.map((s) => s.title).filter(Boolean);
    if (titles.length) lines.push(`Recent topics: ${titles.join("; ")}`);
  }
  return lines.join("\n");
}

// ---------- caching wrapper ----------

async function readCache() {
  if (!globalThis.chrome?.storage?.session) return {};
  const { [CACHE_KEY]: cache } = await chrome.storage.session.get(CACHE_KEY);
  return cache || {};
}

async function writeCache(cache) {
  if (!globalThis.chrome?.storage?.session) return;
  await chrome.storage.session.set({ [CACHE_KEY]: cache });
}

export async function clearSnapshotCache() {
  await writeCache({});
}

// loadSnapshot(email, { force }) — fetches via the client and caches in
// chrome.storage.session. Returns the snapshot. Throws on auth/network.
// Pass force:true to bypass the cache (powering the chip's Retry button).
export async function loadSnapshot(email, { force = false, fetchImpl } = {}) {
  if (!email) throw new Error("email required");
  const cfg = await getIntercomConfig();
  if (!cfg?.apiKey) throw new Error("Intercom API key not set — open Settings to add it.");

  const cache = await readCache();
  const cached = cache[email];
  if (!force && cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.snapshot;
  }

  const client = makeIntercomClient({ apiKey: cfg.apiKey, fetchImpl });
  const snapshot = await client.getCustomerSnapshot(email);

  cache[email] = { snapshot, cachedAt: Date.now() };
  await writeCache(cache);
  return snapshot;
}

// loadSnapshotsForEmails — fans out across multiple emails (the OM ticket
// page sometimes lists more than one). Returns [{ email, snapshot, error }]
// preserving input order. Each entry's error is null on success.
export async function loadSnapshotsForEmails(emails, opts = {}) {
  const unique = [...new Set((emails || []).filter(Boolean))];
  const results = await Promise.all(
    unique.map(async (email) => {
      try {
        const snapshot = await loadSnapshot(email, opts);
        return { email, snapshot, error: null };
      } catch (e) {
        return { email, snapshot: null, error: e.message || String(e) };
      }
    })
  );
  return results;
}
