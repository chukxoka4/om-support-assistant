// Service layer (per ARCHITECTURE.md): wraps lib/intercom-client.js with
// extension-specific concerns — config lookup, session-storage caching,
// chip threshold logic, and a 6–10 line plain-text formatter that compose
// can hand to the LLM.

import { makeIntercomClient } from "./intercom-client.js";
import { getIntercomConfig } from "./storage.js";

const CACHE_KEY = "intercom_snapshot_cache";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes per email

// ---------- threshold logic (pure) ----------

// Returns one of: "vip" | "green" | "yellow" | "red" | "grey"
// VIP overrides every other rule when the tag is present.
export function classifyHealth(snapshot) {
  if (!snapshot || snapshot.found === false) return "grey";
  const tags = (snapshot.tags || []).map((t) => String(t).toLowerCase());
  if (tags.includes("vip")) return "vip";

  const nps = snapshot.npsScore;
  const conv90 = snapshot.conversationsLast90d || 0;
  const lastSeen = snapshot.lastSeenDays;
  const tenure = snapshot.tenureDays || 0;

  // Red — most severe wins.
  if (conv90 >= 5) return "red";
  if (tags.includes("churn-risk")) return "red";
  if (typeof nps === "number" && nps <= 4) return "red";

  // Yellow — at watch.
  if (conv90 >= 3) return "yellow";
  if (typeof lastSeen === "number" && lastSeen > 30) return "yellow";
  if (typeof nps === "number" && nps >= 5 && nps <= 7) return "yellow";

  // Green — high confidence customer.
  if (typeof nps === "number" && nps >= 8) return "green";
  if (tenure > 365 && conv90 <= 1) return "green";

  // Default to grey when none of the rules trigger (we don't know enough).
  return "grey";
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
// Returns a 6–10 line plain-text block. No JSON, no markdown.
export function stringifySnapshot(snapshot) {
  if (!snapshot || snapshot.found === false) {
    return `No Intercom record found for ${snapshot?.email || "this customer"}.`;
  }
  const lines = [];
  lines.push(`Email: ${snapshot.email}`);
  if (snapshot.plan) lines.push(`Plan: ${snapshot.plan}`);
  if (typeof snapshot.tenureDays === "number") {
    lines.push(`Tenure: ${snapshot.tenureDays} days`);
  }
  if (typeof snapshot.lastSeenDays === "number") {
    lines.push(`Last seen: ${snapshot.lastSeenDays} days ago`);
  }
  lines.push(`Conversations in last 90 days: ${snapshot.conversationsLast90d || 0} (${snapshot.openConversations || 0} open)`);
  if (typeof snapshot.npsScore === "number") {
    lines.push(`NPS: ${snapshot.npsScore}`);
  }
  if ((snapshot.tags || []).length) {
    lines.push(`Tags: ${snapshot.tags.join(", ")}`);
  }
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
