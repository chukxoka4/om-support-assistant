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

// Custom-attribute keys we'll probe for NPS, in priority order.
const NPS_KEYS = ["nps_score", "nps", "latest_nps_score", "latest_nps"];

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
  if (!customAttributes) return null;
  for (const k of NPS_KEYS) {
    const v = customAttributes[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && /^\d+(\.\d+)?$/.test(v.trim())) return Number(v);
  }
  return null;
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
    plan: null,
    tenureDays: null,
    lastSeenDays: null,
    openConversations: 0,
    conversationsLast90d: 0,
    npsScore: null,
    tags: [],
    recentSummaries: [],
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

  async function getCustomerSnapshot(email) {
    const contact = await findContactByEmail(email);
    if (!contact) return emptySnapshot(email);

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

    const custom = contact.custom_attributes || {};
    const plan = custom.user_level || custom.plan || null;

    return {
      found: true,
      email: contact.email || email,
      plan,
      tenureDays: tenureDays(contact.created_at),
      lastSeenDays: lastSeenDays(contact.last_seen_at),
      openConversations: open,
      conversationsLast90d: convs.length,
      npsScore: pickNps(custom),
      tags: extractTags(contact),
      recentSummaries: sortedRecent,
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
