// Intercom API client — repository layer (per ARCHITECTURE.md).
// Pure module: no Chrome APIs, no DOM. Takes the API key as a constructor
// argument and an optional fetch implementation (so tests can stub).
//
// Workspace is hardcoded to the US data residency region. The cross-sell
// reference project at ~/projects/cross-sell uses api.intercom.io (US) and
// authenticates fine, so the OM workspace lives there. If we ever see a
// region-mismatch error from Intercom, swap BASE / make it configurable.

const BASE = "https://api.intercom.io";
const VERSION = "2.10";

// Custom-attribute keys we'll probe for, in priority order. Workspace
// schemas vary; the first key with a usable value wins. New variants are
// cheap to add — extend the list, no other code changes.
const NPS_KEYS = ["nps_score", "nps", "latest_nps_score", "latest_nps"];
const PLAN_KEYS = ["user_level", "plan", "plan_name", "subscription_plan"];
const SUB_STATUS_KEYS = ["subscription_status", "status", "subscription_state"];
const MRR_KEYS = ["mrr", "monthly_revenue", "plan_value", "monthly_value"];
const TRIAL_END_KEYS = ["trial_ends_at", "trial_end", "trial_expires_at", "trial_expiry"];

// ---------- pure helpers (exported for tests) ----------

export function tenureDays(createdAtSec) {
  if (!createdAtSec) return null;
  return Math.round((Date.now() - createdAtSec * 1000) / (24 * 3600 * 1000));
}

export function lastSeenDays(lastSeenAtSec) {
  if (!lastSeenAtSec) return null;
  return Math.round((Date.now() - lastSeenAtSec * 1000) / (24 * 3600 * 1000));
}

export function pickNps(customAttributes) {
  return pickNumeric(customAttributes, NPS_KEYS);
}

export function pickPlan(customAttributes) {
  return pickString(customAttributes, PLAN_KEYS);
}

export function pickSubscriptionStatus(customAttributes) {
  return pickString(customAttributes, SUB_STATUS_KEYS);
}

export function pickMrr(customAttributes) {
  return pickNumeric(customAttributes, MRR_KEYS);
}

// Returns days until trial end (negative if expired) or null if not stored.
// Accepts unix-seconds, unix-ms, or ISO date strings.
export function trialEndsInDays(customAttributes) {
  if (!customAttributes) return null;
  for (const k of TRIAL_END_KEYS) {
    const v = customAttributes[k];
    if (v == null || v === "") continue;
    let ms = null;
    if (typeof v === "number") ms = v > 1e12 ? v : v * 1000;
    else if (typeof v === "string") {
      const t = Date.parse(v);
      if (!Number.isNaN(t)) ms = t;
      else if (/^\d+$/.test(v)) ms = Number(v) > 1e12 ? Number(v) : Number(v) * 1000;
    }
    if (ms == null) continue;
    return Math.round((ms - Date.now()) / (24 * 3600 * 1000));
  }
  return null;
}

function pickNumeric(custom, keys) {
  if (!custom) return null;
  for (const k of keys) {
    const v = custom[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
  }
  return null;
}

function pickString(custom, keys) {
  if (!custom) return null;
  for (const k of keys) {
    const v = custom[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

// Days since a unix-seconds timestamp, or null if missing.
export function daysSinceSec(sec) {
  if (!sec) return null;
  return Math.round((Date.now() - sec * 1000) / (24 * 3600 * 1000));
}

export function extractTags(contact) {
  // Intercom returns tags either as { tags: { data: [...] } } or
  // { tags: { tags: [...] } } depending on the endpoint. Cover both.
  const arr = contact?.tags?.data || contact?.tags?.tags || [];
  return arr.map((t) => t?.name).filter(Boolean);
}

export function emptySnapshot(email) {
  return {
    found: false,
    email,
    name: null,

    // Subscription / billing
    plan: null,
    subscriptionStatus: null,
    mrr: null,
    trialEndsInDays: null,
    tenureDays: null,

    // Engagement
    lastSeenDays: null,
    lastRequestDays: null,
    sessionCount: null,
    lastEmailOpenDays: null,
    lastEmailClickDays: null,
    unsubscribedFromEmails: false,
    hasHardBounced: false,

    // Identity / context
    companyName: null,
    companySeats: null,
    location: null,
    language: null,
    tags: [],

    // Survey / feedback
    npsScore: null,

    // Conversations endpoint result (will be empty for OM workspaces that
    // route support through tools other than Intercom — kept for forwards
    // compatibility).
    openConversations: 0,
    conversationsLast90d: 0,
    recentSummaries: [],

    // Raw custom attributes verbatim — fuels the chip's "Custom" section
    // and one-time diagnostic logging when fetched.
    customAttributes: {},

    raw: null
  };
}

// ---------- client factory ----------

export function makeIntercomClient({ apiKey, fetchImpl = (...a) => fetch(...a) }) {
  if (!apiKey || typeof apiKey !== "string") {
    throw new Error("Intercom API key required");
  }

  async function call(path, { method = "GET", body } = {}) {
    const res = await fetchImpl(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "Intercom-Version": VERSION
      },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
      let errBody = "";
      try { errBody = await res.text(); } catch { /* ignore */ }
      const snippet = errBody.replace(/\s+/g, " ").slice(0, 200);
      throw new Error(`Intercom ${res.status}: ${snippet || res.statusText || "error"}`);
    }
    return res.json();
  }

  async function findContactByEmail(email) {
    if (!email) return null;
    const r = await call("/contacts/search", {
      method: "POST",
      body: { query: { field: "email", operator: "=", value: email } }
    });
    return (r.data && r.data[0]) || null;
  }

  async function searchCustomers(query, limit = 5) {
    if (!query) return [];
    const r = await call("/contacts/search", {
      method: "POST",
      body: {
        query: {
          operator: "OR",
          value: [
            { field: "email", operator: "~", value: query },
            { field: "name", operator: "~", value: query }
          ]
        },
        pagination: { per_page: limit }
      }
    });
    return (r.data || []).slice(0, limit);
  }

  async function getRecentConversations(contactId, { sinceSec = null, limit = 30 } = {}) {
    if (!contactId) return [];
    const filters = [{ field: "contact_ids", operator: "=", value: contactId }];
    if (sinceSec) filters.push({ field: "created_at", operator: ">", value: sinceSec });
    const query = filters.length === 1 ? filters[0] : { operator: "AND", value: filters };
    try {
      const r = await call("/conversations/search", {
        method: "POST",
        body: { query, pagination: { per_page: limit } }
      });
      // Intercom returns { conversations: [...] } on this endpoint.
      return r.conversations || r.data || [];
    } catch (_e) {
      // Conversations search can fail on permission or endpoint drift —
      // surface a partial snapshot rather than failing the whole chip.
      return [];
    }
  }

  function summariseConversation(c) {
    const rawBody = c?.source?.body || "";
    const stripped = rawBody.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    return {
      id: c?.id || null,
      title: c?.title || c?.source?.subject || "(no subject)",
      summary: stripped.slice(0, 200),
      createdAt: c?.created_at || null
    };
  }

  async function getCompanyForContact(contactId) {
    if (!contactId) return null;
    try {
      const r = await call(`/contacts/${contactId}/companies`);
      const first = (r?.data || r?.companies || [])[0];
      if (!first) return null;
      return {
        name: first.name || null,
        seats: typeof first.user_count === "number" ? first.user_count : null
      };
    } catch (_e) {
      return null; // missing endpoint or perm — partial snapshot
    }
  }

  async function getCustomerSnapshot(email) {
    const contact = await findContactByEmail(email);
    if (!contact) return emptySnapshot(email);

    // Conversations: OM probably doesn't use Intercom for support, so this
    // is effectively a no-op. Kept for forwards compatibility.
    const ninetyDaysAgoSec = Math.floor((Date.now() - 90 * 24 * 3600 * 1000) / 1000);
    const convs = await getRecentConversations(contact.id, {
      sinceSec: ninetyDaysAgoSec,
      limit: 30
    });
    const open = convs.filter((c) => c?.state === "open" || c?.open === true).length;
    const sortedRecent = [...convs]
      .sort((a, b) => (b?.created_at || 0) - (a?.created_at || 0))
      .slice(0, 3)
      .map(summariseConversation);

    const company = await getCompanyForContact(contact.id);
    const custom = contact.custom_attributes || {};

    const loc = contact.location?.country
      ? [contact.location.city, contact.location.region, contact.location.country].filter(Boolean).join(", ")
      : null;

    return {
      found: true,
      email: contact.email || email,
      name: contact.name || null,

      // Subscription
      plan: pickPlan(custom),
      subscriptionStatus: pickSubscriptionStatus(custom),
      mrr: pickMrr(custom),
      trialEndsInDays: trialEndsInDays(custom),
      tenureDays: tenureDays(contact.created_at),

      // Engagement
      lastSeenDays: lastSeenDays(contact.last_seen_at),
      lastRequestDays: daysSinceSec(contact.last_request_at),
      sessionCount: typeof contact.session_count === "number" ? contact.session_count : null,
      lastEmailOpenDays: daysSinceSec(contact.last_email_opened_at),
      lastEmailClickDays: daysSinceSec(contact.last_email_clicked_at),
      unsubscribedFromEmails: !!contact.unsubscribed_from_emails,
      hasHardBounced: !!contact.has_hard_bounced,

      // Identity
      companyName: company?.name || null,
      companySeats: company?.seats || null,
      location: loc,
      language: contact.language_override || null,
      tags: extractTags(contact),

      // Survey
      npsScore: pickNps(custom),

      // Conversations (probably empty for OM)
      openConversations: open,
      conversationsLast90d: convs.length,
      recentSummaries: sortedRecent,

      customAttributes: { ...custom },
      raw: contact
    };
  }

  return {
    call,
    findContactByEmail,
    searchCustomers,
    getRecentConversations,
    getCustomerSnapshot
  };
}
