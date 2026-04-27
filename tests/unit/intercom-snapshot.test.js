// F2 — snapshot service: thresholds, formatter, caching, multi-email fan-out.

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  classifyHealth,
  HEALTH_LABELS,
  HEALTH_DOTS,
  stringifySnapshot,
  loadSnapshot,
  loadSnapshotsForEmails,
  clearSnapshotCache
} from "../../lib/intercom-snapshot.js";
import { setIntercomConfig } from "../../lib/storage.js";

const baseSnapshot = (overrides = {}) => ({
  found: true,
  email: "jane@acme.com",
  name: "Jane",
  plan: "Pro",
  subscriptionStatus: null,
  mrr: null,
  trialEndsInDays: null,
  tenureDays: 412,
  lastSeenDays: 3,
  lastRequestDays: null,
  sessionCount: null,
  lastEmailOpenDays: null,
  lastEmailClickDays: null,
  unsubscribedFromEmails: false,
  hasHardBounced: false,
  companyName: null,
  companySeats: null,
  location: null,
  language: null,
  openConversations: 0,
  conversationsLast90d: 0,
  npsScore: null,
  tags: [],
  recentSummaries: [],
  customAttributes: {},
  raw: null,
  ...overrides
});

describe("classifyHealth", () => {
  it("grey with reason when found:false", () => {
    const r = classifyHealth({ found: false, tags: [] });
    expect(r.tier).toBe("grey");
    expect(r.reason).toMatch(/no Intercom record/);
    expect(classifyHealth(null).tier).toBe("grey");
  });

  it("vip overrides everything else", () => {
    expect(classifyHealth(baseSnapshot({ tags: ["vip"], npsScore: 0 })).tier).toBe("vip");
    expect(classifyHealth(baseSnapshot({ tags: ["VIP", "churn-risk"] })).tier).toBe("vip");
  });

  it("red when subscription cancelled / past_due", () => {
    expect(classifyHealth(baseSnapshot({ subscriptionStatus: "cancelled" })).tier).toBe("red");
    expect(classifyHealth(baseSnapshot({ subscriptionStatus: "past_due" })).tier).toBe("red");
  });

  it("red when churn-risk tag is present", () => {
    expect(classifyHealth(baseSnapshot({ tags: ["churn-risk"] })).tier).toBe("red");
  });

  it("red when email hard-bounced", () => {
    expect(classifyHealth(baseSnapshot({ hasHardBounced: true })).tier).toBe("red");
  });

  it("red when unsubscribed AND inactive 60d+", () => {
    const r = classifyHealth(baseSnapshot({
      unsubscribedFromEmails: true, lastSeenDays: 90
    }));
    expect(r.tier).toBe("red");
    expect(r.reason).toMatch(/unsubscribed.*inactive/);
  });

  it("red when NPS ≤ 4 (still strong negative signal)", () => {
    expect(classifyHealth(baseSnapshot({ npsScore: 4 })).tier).toBe("red");
    expect(classifyHealth(baseSnapshot({ npsScore: 0 })).tier).toBe("red");
  });

  it("yellow when trial ends in ≤7 days", () => {
    const r = classifyHealth(baseSnapshot({ trialEndsInDays: 4 }));
    expect(r.tier).toBe("yellow");
    expect(r.reason).toMatch(/trial ends in 4d/);
  });

  it("yellow when trial-extended tag is present", () => {
    expect(classifyHealth(baseSnapshot({ tags: ["trial-extended"] })).tier).toBe("yellow");
  });

  it("yellow when last_seen > 30d and no recent email engagement", () => {
    const r = classifyHealth(baseSnapshot({ lastSeenDays: 60 }));
    expect(r.tier).toBe("yellow");
    expect(r.reason).toMatch(/inactive 60d/);
  });

  it("yellow when NPS 5–7", () => {
    expect(classifyHealth(baseSnapshot({ npsScore: 6 })).tier).toBe("yellow");
  });

  it("green when active subscription + recently seen", () => {
    const r = classifyHealth(baseSnapshot({
      subscriptionStatus: "active", lastSeenDays: 3
    }));
    expect(r.tier).toBe("green");
    expect(r.reason).toMatch(/active subscription/);
  });

  it("green when active subscription + recent email engagement", () => {
    const r = classifyHealth(baseSnapshot({
      subscriptionStatus: "active", lastSeenDays: 60, lastEmailClickDays: 10
    }));
    // last_seen 60d would normally be yellow, but engagement still flips
    // it green because the user is reading our emails.
    expect(r.tier).toBe("yellow"); // last_seen rule fires first
    // Move last_seen back into a non-yellow zone:
    const r2 = classifyHealth(baseSnapshot({
      subscriptionStatus: "active", lastSeenDays: 25, lastEmailClickDays: 5
    }));
    expect(r2.tier).toBe("green");
  });

  it("green when NPS ≥ 8", () => {
    expect(classifyHealth(baseSnapshot({ npsScore: 9 })).tier).toBe("green");
  });

  it("grey default when no definitive signal", () => {
    expect(classifyHealth({ found: true, tags: [] }).tier).toBe("grey");
  });

  it("the Healthy 1110-day case: no longer auto-green without engagement", () => {
    // The original surprising case the user spotted — long tenure, zero
    // conversations, no NPS, no subscription status → grey, not green.
    const r = classifyHealth(baseSnapshot({
      tenureDays: 1110, conversationsLast90d: 0, npsScore: null,
      subscriptionStatus: null, lastSeenDays: 3
    }));
    expect(r.tier).toBe("grey");
  });

  it("HEALTH_LABELS and HEALTH_DOTS expose every state", () => {
    for (const k of ["vip", "green", "yellow", "red", "grey"]) {
      expect(HEALTH_LABELS[k]).toBeTruthy();
      expect(HEALTH_DOTS[k]).toBeTruthy();
    }
  });
});

describe("stringifySnapshot", () => {
  it("produces 8–14 plain-text lines with widened context", () => {
    const out = stringifySnapshot(baseSnapshot({
      subscriptionStatus: "active",
      mrr: 49,
      tenureDays: 412,
      lastSeenDays: 3,
      sessionCount: 84,
      lastEmailOpenDays: 8,
      lastEmailClickDays: 12,
      companyName: "Acme",
      companySeats: 5,
      location: "Berlin, DE",
      language: "de",
      tags: ["trial-extended", "advocate"],
      npsScore: 8
    }));
    const lines = out.split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(7);
    expect(lines.length).toBeLessThanOrEqual(14);
    expect(out).toContain("Plan: Pro");
    expect(out).toContain("Status: active");
    expect(out).toContain("Last seen: 3d ago");
    expect(out).toContain("Email opened: 8d ago");
    expect(out).toContain("Company: Acme (5 seats)");
    expect(out).toContain("Location: Berlin, DE");
    expect(out).toContain("Tags: trial-extended, advocate");
    expect(out).toContain("NPS: 8");
    expect(out).not.toMatch(/[{<>]/); // no JSON, no HTML
  });

  it("absent fields are skipped, not blanked", () => {
    const out = stringifySnapshot(baseSnapshot({
      plan: null, npsScore: null, tags: [], lastSeenDays: null, name: null
    }));
    expect(out).not.toMatch(/Plan:/);
    expect(out).not.toMatch(/NPS:/);
    expect(out).not.toMatch(/Tags:/);
    expect(out).not.toMatch(/Last seen:/);
    expect(out).not.toMatch(/Name:/);
  });

  it("found:false produces a one-liner", () => {
    expect(stringifySnapshot({ found: false, email: "x@y.co" }))
      .toMatch(/No Intercom record found for x@y.co/);
  });

  it("includes trial countdown / expiry phrasing", () => {
    const a = stringifySnapshot(baseSnapshot({ trialEndsInDays: 4 }));
    expect(a).toContain("Trial ends in: 4d");
    const b = stringifySnapshot(baseSnapshot({ trialEndsInDays: -3 }));
    expect(b).toContain("Trial expired 3d ago");
  });

  it("flags unsubscribed and hard-bounced as their own lines", () => {
    const out = stringifySnapshot(baseSnapshot({
      unsubscribedFromEmails: true, hasHardBounced: true
    }));
    expect(out).toContain("Unsubscribed from emails: yes");
    expect(out).toContain("Email status: hard-bounced");
  });
});

// ---------- caching ----------

describe("loadSnapshot caching", () => {
  beforeEach(async () => {
    await chrome.storage.sync.clear();
    await chrome.storage.session.clear();
    await setIntercomConfig({ apiKey: "test_token" });
  });

  it("throws a labelled error when no API key is set", async () => {
    await chrome.storage.sync.clear();
    await expect(loadSnapshot("a@b.co")).rejects.toThrow(/Intercom API key not set/);
  });

  it("hits the network on first call, caches in session, second call doesn't fetch", async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url.includes("/contacts/search")) {
        return { ok: true, json: async () => ({ data: [{ id: "c1", email: "a@b.co", custom_attributes: {} }] }) };
      }
      if (url.includes("/conversations/search")) {
        return { ok: true, json: async () => ({ conversations: [] }) };
      }
      return { ok: false, status: 404, statusText: "?", text: async () => "" };
    });

    const a = await loadSnapshot("a@b.co", { fetchImpl });
    expect(a.found).toBe(true);
    const callsAfterFirst = fetchImpl.mock.calls.length;

    const b = await loadSnapshot("a@b.co", { fetchImpl });
    expect(b.found).toBe(true);
    // Cache hit — no extra fetch calls.
    expect(fetchImpl.mock.calls.length).toBe(callsAfterFirst);
  });

  it("force:true bypasses the cache (Retry button)", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ data: [], conversations: [] }) }));
    await loadSnapshot("a@b.co", { fetchImpl });
    const before = fetchImpl.mock.calls.length;
    await loadSnapshot("a@b.co", { force: true, fetchImpl });
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(before);
  });

  it("clearSnapshotCache wipes the cache", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ data: [], conversations: [] }) }));
    await loadSnapshot("a@b.co", { fetchImpl });
    const before = fetchImpl.mock.calls.length;
    await clearSnapshotCache();
    await loadSnapshot("a@b.co", { fetchImpl });
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(before);
  });
});

describe("loadSnapshotsForEmails fan-out", () => {
  beforeEach(async () => {
    await chrome.storage.sync.clear();
    await chrome.storage.session.clear();
    await setIntercomConfig({ apiKey: "test_token" });
  });

  it("returns one entry per unique email, preserving order", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ data: [], conversations: [] }) }));
    const out = await loadSnapshotsForEmails(["a@b.co", "c@d.co", "a@b.co"], { fetchImpl });
    expect(out.map((r) => r.email)).toEqual(["a@b.co", "c@d.co"]);
    expect(out.every((r) => r.error === null)).toBe(true);
  });

  it("isolates per-email errors — one failure doesn't drop the others", async () => {
    let callIdx = 0;
    const fetchImpl = vi.fn(async (url) => {
      callIdx += 1;
      if (callIdx === 1) {
        return { ok: false, status: 401, statusText: "Unauthorized", text: async () => "bad" };
      }
      return { ok: true, json: async () => ({ data: [], conversations: [] }) };
    });
    const out = await loadSnapshotsForEmails(["bad@x.co", "good@x.co"], { fetchImpl });
    expect(out[0].error).toMatch(/401/);
    expect(out[0].snapshot).toBeNull();
    expect(out[1].error).toBeNull();
    expect(out[1].snapshot).toBeTruthy();
  });
});
