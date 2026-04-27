// F2 — Intercom client (pure repository layer).

import { describe, it, expect, vi } from "vitest";
import {
  makeIntercomClient,
  tenureDays,
  lastSeenDays,
  pickNps,
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
  it("happy path: maps custom attributes, tenure, last seen, conversations, NPS, tags", async () => {
    const fetchImpl = fakeFetch({
      "POST /contacts/search": () => ({
        data: [{
          id: "c-1",
          email: "jane@acme.com",
          created_at: SEC(412 * 24 * 3600 * 1000),    // 412 days ago
          last_seen_at: SEC(3 * 24 * 3600 * 1000),    // 3 days ago
          custom_attributes: { user_level: "Pro", nps_score: 6 },
          tags: { data: [{ name: "trial-extended" }] }
        }]
      }),
      "POST /conversations/search": () => ({
        conversations: [
          { id: "conv-1", state: "open", created_at: SEC(3 * 24 * 3600 * 1000),
            title: "Integration broken", source: { body: "<p>It stopped working</p>" } },
          { id: "conv-2", state: "closed", created_at: SEC(12 * 24 * 3600 * 1000),
            title: "Billing q", source: { body: "" } },
          { id: "conv-3", state: "closed", created_at: SEC(28 * 24 * 3600 * 1000),
            title: "Refund", source: { body: "" } },
          { id: "conv-4", state: "closed", created_at: SEC(60 * 24 * 3600 * 1000),
            title: "Account access", source: { body: "" } }
        ]
      })
    });
    const c = makeIntercomClient({ apiKey: "x", fetchImpl });
    const snap = await c.getCustomerSnapshot("jane@acme.com");
    expect(snap.found).toBe(true);
    expect(snap.email).toBe("jane@acme.com");
    expect(snap.plan).toBe("Pro");
    expect(snap.tenureDays).toBe(412);
    expect(snap.lastSeenDays).toBe(3);
    expect(snap.openConversations).toBe(1);
    expect(snap.conversationsLast90d).toBe(4);
    expect(snap.npsScore).toBe(6);
    expect(snap.tags).toEqual(["trial-extended"]);
    expect(snap.recentSummaries).toHaveLength(3);
    // Sorted newest first.
    expect(snap.recentSummaries[0].title).toBe("Integration broken");
    // Body HTML stripped.
    expect(snap.recentSummaries[0].summary).toBe("It stopped working");
  });

  it("falls back to plan attribute when user_level missing", async () => {
    const fetchImpl = fakeFetch({
      "POST /contacts/search": () => ({
        data: [{ id: "c", email: "x@y.co", custom_attributes: { plan: "Growth" } }]
      }),
      "POST /conversations/search": () => ({ conversations: [] })
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
      "POST /conversations/search": () => ({ __error: true, status: 403, body: "Forbidden" })
    });
    const c = makeIntercomClient({ apiKey: "x", fetchImpl });
    const snap = await c.getCustomerSnapshot("x@y.co");
    expect(snap.found).toBe(true);
    expect(snap.plan).toBe("Free");
    expect(snap.openConversations).toBe(0);
    expect(snap.conversationsLast90d).toBe(0);
    expect(snap.recentSummaries).toEqual([]);
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
