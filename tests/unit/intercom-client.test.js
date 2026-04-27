// F2 — Intercom client (pure repository layer).

import { describe, it, expect, vi } from "vitest";
import {
  makeIntercomClient,
  tenureDays,
  lastSeenDays,
  pickNps,
  pickPlan,
  pickSubscriptionStatus,
  pickMrr,
  trialEndsInDays,
  daysSinceSec,
  extractTags,
  emptySnapshot
} from "../../lib/intercom-client.js";

const NOW = Date.now();
const SEC = (msAgo) => Math.floor((NOW - msAgo) / 1000);

function fakeFetch(handlers) {
  return vi.fn(async (url, options) => {
    const path = url.replace("https://api.intercom.io", "");
    const handler = handlers[`${options?.method || "GET"} ${path}`];
    if (!handler) {
      return { ok: false, status: 404, statusText: "no handler", text: async () => "no mock" };
    }
    const result = await handler(JSON.parse(options?.body || "null"), options);
    if (result.__error) {
      return { ok: false, status: result.status, statusText: result.statusText || "err", text: async () => result.body || "" };
    }
    return { ok: true, status: 200, json: async () => result };
  });
}

describe("pure helpers", () => {
  it("tenureDays / lastSeenDays return null for missing input", () => {
    expect(tenureDays(null)).toBeNull();
    expect(tenureDays(undefined)).toBeNull();
    expect(lastSeenDays(0)).toBeNull();
  });

  it("tenureDays computes whole days from unix seconds", () => {
    const tenDaysAgoSec = Math.floor((Date.now() - 10 * 24 * 3600 * 1000) / 1000);
    expect(tenureDays(tenDaysAgoSec)).toBe(10);
  });

  it("pickNps probes nps_score, nps, latest_nps_score, latest_nps in order", () => {
    expect(pickNps({ nps_score: 8 })).toBe(8);
    expect(pickNps({ nps: 6 })).toBe(6);
    expect(pickNps({ latest_nps_score: 9 })).toBe(9);
    expect(pickNps({ latest_nps: 4 })).toBe(4);
  });

  it("pickNps prefers earlier keys when several present", () => {
    expect(pickNps({ nps_score: 8, nps: 1 })).toBe(8);
  });

  it("pickNps coerces numeric strings", () => {
    expect(pickNps({ nps_score: "7" })).toBe(7);
    expect(pickNps({ nps_score: "9.5" })).toBe(9.5);
  });

  it("pickNps returns null for non-numeric or missing", () => {
    expect(pickNps(null)).toBeNull();
    expect(pickNps({})).toBeNull();
    expect(pickNps({ nps_score: "n/a" })).toBeNull();
    expect(pickNps({ nps_score: null })).toBeNull();
  });

  it("extractTags handles both Intercom shapes (.data and .tags)", () => {
    expect(extractTags({ tags: { data: [{ name: "vip" }, { name: "trial" }] } }))
      .toEqual(["vip", "trial"]);
    expect(extractTags({ tags: { tags: [{ name: "churn-risk" }] } }))
      .toEqual(["churn-risk"]);
    expect(extractTags({})).toEqual([]);
    expect(extractTags(null)).toEqual([]);
  });

  it("emptySnapshot has the contract shape with found:false", () => {
    const s = emptySnapshot("a@b.co");
    expect(s.found).toBe(false);
    expect(s.email).toBe("a@b.co");
    expect(s.tags).toEqual([]);
    expect(s.recentSummaries).toEqual([]);
    expect(s.raw).toBeNull();
    expect(s.customAttributes).toEqual({});
    expect(s.subscriptionStatus).toBeNull();
    expect(s.companyName).toBeNull();
  });

  it("pickPlan probes user_level → plan → plan_name → subscription_plan", () => {
    expect(pickPlan({ user_level: "Pro" })).toBe("Pro");
    expect(pickPlan({ plan: "Growth" })).toBe("Growth");
    expect(pickPlan({ plan_name: "Pro+" })).toBe("Pro+");
    expect(pickPlan({ subscription_plan: "Free" })).toBe("Free");
    expect(pickPlan({ user_level: "Pro", plan: "ignored" })).toBe("Pro");
    expect(pickPlan({})).toBeNull();
    expect(pickPlan(null)).toBeNull();
    expect(pickPlan({ user_level: "  " })).toBeNull();
  });

  it("pickSubscriptionStatus probes subscription_status → status → subscription_state", () => {
    expect(pickSubscriptionStatus({ subscription_status: "active" })).toBe("active");
    expect(pickSubscriptionStatus({ status: "cancelled" })).toBe("cancelled");
    expect(pickSubscriptionStatus({})).toBeNull();
  });

  it("pickMrr accepts numbers and numeric strings, including negatives", () => {
    expect(pickMrr({ mrr: 49 })).toBe(49);
    expect(pickMrr({ monthly_revenue: "29.5" })).toBe(29.5);
    expect(pickMrr({ plan_value: "-10" })).toBe(-10);
    expect(pickMrr({})).toBeNull();
    expect(pickMrr({ mrr: "n/a" })).toBeNull();
  });

  it("trialEndsInDays handles unix-seconds, unix-ms, ISO strings", () => {
    const sevenDaysAheadSec = Math.floor((Date.now() + 7 * 24 * 3600 * 1000) / 1000);
    expect(trialEndsInDays({ trial_ends_at: sevenDaysAheadSec })).toBe(7);
    expect(trialEndsInDays({ trial_end: Date.now() + 3 * 24 * 3600 * 1000 })).toBe(3);
    expect(trialEndsInDays({ trial_expires_at: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString() })).toBe(-2);
    expect(trialEndsInDays({})).toBeNull();
    expect(trialEndsInDays(null)).toBeNull();
  });

  it("daysSinceSec returns null for missing", () => {
    expect(daysSinceSec(null)).toBeNull();
    expect(daysSinceSec(0)).toBeNull();
    const tenDaysAgoSec = Math.floor((Date.now() - 10 * 24 * 3600 * 1000) / 1000);
    expect(daysSinceSec(tenDaysAgoSec)).toBe(10);
  });
});

describe("client factory", () => {
  it("throws when constructed without an api key", () => {
    expect(() => makeIntercomClient({})).toThrow(/api key/i);
    expect(() => makeIntercomClient({ apiKey: "" })).toThrow();
  });

  it("call() sets the right headers and bearer auth", async () => {
    const fetchImpl = fakeFetch({
      "GET /me": () => ({ ok: true, type: "admin" })
    });
    const c = makeIntercomClient({ apiKey: "tok_x", fetchImpl });
    const r = await c.call("/me");
    expect(r.type).toBe("admin");
    const [, opts] = fetchImpl.mock.calls[0];
    expect(opts.headers.Authorization).toBe("Bearer tok_x");
    expect(opts.headers["Intercom-Version"]).toBe("2.10");
    expect(opts.headers.Accept).toBe("application/json");
  });

  it("call() throws a labelled error on non-2xx", async () => {
    const fetchImpl = fakeFetch({
      "GET /denied": () => ({ __error: true, status: 401, body: "Unauthorized — bad token" })
    });
    const c = makeIntercomClient({ apiKey: "tok_x", fetchImpl });
    await expect(c.call("/denied")).rejects.toThrow(/Intercom 401: Unauthorized/);
  });
});

describe("findContactByEmail", () => {
  it("returns the first hit", async () => {
    const fetchImpl = fakeFetch({
      "POST /contacts/search": (body) => {
        expect(body.query).toEqual({ field: "email", operator: "=", value: "a@b.co" });
        return { data: [{ id: "c1", email: "a@b.co" }] };
      }
    });
    const c = makeIntercomClient({ apiKey: "x", fetchImpl });
    const hit = await c.findContactByEmail("a@b.co");
    expect(hit.id).toBe("c1");
  });

  it("returns null when nothing found", async () => {
    const fetchImpl = fakeFetch({
      "POST /contacts/search": () => ({ data: [] })
    });
    const c = makeIntercomClient({ apiKey: "x", fetchImpl });
    expect(await c.findContactByEmail("ghost@example.com")).toBeNull();
  });
});

describe("getCustomerSnapshot", () => {
  it("happy path: maps engagement signals, subscription, identity, tags", async () => {
    const fetchImpl = fakeFetch({
      "POST /contacts/search": () => ({
        data: [{
          id: "c-1",
          email: "jane@acme.com",
          name: "Jane",
          created_at: SEC(412 * 24 * 3600 * 1000),
          last_seen_at: SEC(3 * 24 * 3600 * 1000),
          last_request_at: SEC(2 * 24 * 3600 * 1000),
          session_count: 84,
          last_email_opened_at: SEC(8 * 24 * 3600 * 1000),
          last_email_clicked_at: SEC(12 * 24 * 3600 * 1000),
          unsubscribed_from_emails: false,
          has_hard_bounced: false,
          language_override: "de",
          location: { country: "Germany", region: "Berlin", city: "Berlin" },
          custom_attributes: {
            user_level: "Pro",
            subscription_status: "active",
            mrr: 49,
            nps_score: 8,
            has_wordpress_site: true
          },
          tags: { data: [{ name: "advocate" }] }
        }]
      }),
      "POST /conversations/search": () => ({ conversations: [] }),
      "GET /contacts/c-1/companies": () => ({ data: [{ name: "Acme", user_count: 5 }] })
    });
    const c = makeIntercomClient({ apiKey: "x", fetchImpl });
    const snap = await c.getCustomerSnapshot("jane@acme.com");
    expect(snap.found).toBe(true);
    expect(snap.name).toBe("Jane");
    expect(snap.plan).toBe("Pro");
    expect(snap.subscriptionStatus).toBe("active");
    expect(snap.mrr).toBe(49);
    expect(snap.tenureDays).toBe(412);
    expect(snap.lastSeenDays).toBe(3);
    expect(snap.lastRequestDays).toBe(2);
    expect(snap.sessionCount).toBe(84);
    expect(snap.lastEmailOpenDays).toBe(8);
    expect(snap.lastEmailClickDays).toBe(12);
    expect(snap.unsubscribedFromEmails).toBe(false);
    expect(snap.hasHardBounced).toBe(false);
    expect(snap.language).toBe("de");
    expect(snap.location).toBe("Berlin, Berlin, Germany");
    expect(snap.npsScore).toBe(8);
    expect(snap.tags).toEqual(["advocate"]);
    expect(snap.companyName).toBe("Acme");
    expect(snap.companySeats).toBe(5);
    expect(snap.customAttributes).toEqual({
      user_level: "Pro",
      subscription_status: "active",
      mrr: 49,
      nps_score: 8,
      has_wordpress_site: true
    });
    expect(snap.conversationsLast90d).toBe(0);
  });

  it("falls back to plan attribute when user_level missing", async () => {
    const fetchImpl = fakeFetch({
      "POST /contacts/search": () => ({
        data: [{ id: "c", email: "x@y.co", custom_attributes: { plan: "Growth" } }]
      }),
      "POST /conversations/search": () => ({ conversations: [] }),
      "GET /contacts/c/companies": () => ({ data: [] })
    });
    const c = makeIntercomClient({ apiKey: "x", fetchImpl });
    const snap = await c.getCustomerSnapshot("x@y.co");
    expect(snap.plan).toBe("Growth");
  });

  it("missing contact → emptySnapshot with found:false", async () => {
    const fetchImpl = fakeFetch({
      "POST /contacts/search": () => ({ data: [] })
    });
    const c = makeIntercomClient({ apiKey: "x", fetchImpl });
    const snap = await c.getCustomerSnapshot("nope@nope.co");
    expect(snap.found).toBe(false);
    expect(snap.email).toBe("nope@nope.co");
    expect(snap.tags).toEqual([]);
  });

  it("conversation search failure produces a partial snapshot, not a thrown error", async () => {
    const fetchImpl = fakeFetch({
      "POST /contacts/search": () => ({
        data: [{ id: "c", email: "x@y.co", custom_attributes: { user_level: "Free" } }]
      }),
      "POST /conversations/search": () => ({ __error: true, status: 403, body: "Forbidden" }),
      "GET /contacts/c/companies": () => ({ data: [] })
    });
    const c = makeIntercomClient({ apiKey: "x", fetchImpl });
    const snap = await c.getCustomerSnapshot("x@y.co");
    expect(snap.found).toBe(true);
    expect(snap.plan).toBe("Free");
    expect(snap.openConversations).toBe(0);
    expect(snap.conversationsLast90d).toBe(0);
    expect(snap.recentSummaries).toEqual([]);
  });

  it("companies endpoint failure leaves company fields null without throwing", async () => {
    const fetchImpl = fakeFetch({
      "POST /contacts/search": () => ({
        data: [{ id: "c", email: "x@y.co", custom_attributes: {} }]
      }),
      "POST /conversations/search": () => ({ conversations: [] }),
      "GET /contacts/c/companies": () => ({ __error: true, status: 403, body: "Forbidden" })
    });
    const c = makeIntercomClient({ apiKey: "x", fetchImpl });
    const snap = await c.getCustomerSnapshot("x@y.co");
    expect(snap.companyName).toBeNull();
    expect(snap.companySeats).toBeNull();
  });
});

describe("searchCustomers", () => {
  it("issues an OR query on email and name and returns up to N hits", async () => {
    const fetchImpl = fakeFetch({
      "POST /contacts/search": (body) => {
        expect(body.query.operator).toBe("OR");
        expect(body.query.value).toHaveLength(2);
        expect(body.query.value[0].field).toBe("email");
        expect(body.query.value[1].field).toBe("name");
        expect(body.pagination.per_page).toBe(3);
        return { data: [{ id: "1" }, { id: "2" }, { id: "3" }, { id: "4" }] };
      }
    });
    const c = makeIntercomClient({ apiKey: "x", fetchImpl });
    const r = await c.searchCustomers("jane", 3);
    expect(r).toHaveLength(3);
  });

  it("empty query → empty array, no fetch", async () => {
    const fetchImpl = fakeFetch({});
    const c = makeIntercomClient({ apiKey: "x", fetchImpl });
    expect(await c.searchCustomers("")).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
