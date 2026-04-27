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
  plan: "Pro",
  tenureDays: 412,
  lastSeenDays: 3,
  openConversations: 1,
  conversationsLast90d: 4,
  npsScore: 6,
  tags: ["trial-extended"],
  recentSummaries: [],
  raw: null,
  ...overrides
});

describe("classifyHealth", () => {
  it("grey when found:false", () => {
    expect(classifyHealth({ found: false, tags: [] })).toBe("grey");
    expect(classifyHealth(null)).toBe("grey");
  });

  it("vip overrides everything else", () => {
    expect(classifyHealth(baseSnapshot({ tags: ["vip"], conversationsLast90d: 9, npsScore: 0 })))
      .toBe("vip");
    expect(classifyHealth(baseSnapshot({ tags: ["VIP", "churn-risk"] }))).toBe("vip");
  });

  it("red when 5+ conversations in 90d", () => {
    expect(classifyHealth(baseSnapshot({ conversationsLast90d: 5, npsScore: 9 }))).toBe("red");
  });

  it("red when churn-risk tag is present", () => {
    expect(classifyHealth(baseSnapshot({ tags: ["churn-risk"], conversationsLast90d: 0 })))
      .toBe("red");
  });

  it("red when NPS ≤ 4", () => {
    expect(classifyHealth(baseSnapshot({ npsScore: 4, conversationsLast90d: 1 }))).toBe("red");
    expect(classifyHealth(baseSnapshot({ npsScore: 0, conversationsLast90d: 0 }))).toBe("red");
  });

  it("yellow when 3–4 convs, last seen >30d, or NPS 5–7", () => {
    expect(classifyHealth(baseSnapshot({ conversationsLast90d: 3, npsScore: 9 }))).toBe("yellow");
    expect(classifyHealth(baseSnapshot({ lastSeenDays: 31, conversationsLast90d: 0 })))
      .toBe("yellow");
    expect(classifyHealth(baseSnapshot({ npsScore: 6, conversationsLast90d: 0 }))).toBe("yellow");
  });

  it("green when NPS ≥ 8", () => {
    expect(classifyHealth(baseSnapshot({ npsScore: 9, conversationsLast90d: 4 })))
      // 4 convs would be yellow — but NPS 9 doesn't beat the yellow rule.
      // NPS 8+ wins only if no yellow/red triggers fired first.
      .toBe("yellow");
    expect(classifyHealth(baseSnapshot({ npsScore: 9, conversationsLast90d: 1, lastSeenDays: 1 })))
      .toBe("green");
  });

  it("green when tenure > 365d AND ≤1 conv90d", () => {
    expect(classifyHealth(baseSnapshot({ tenureDays: 500, conversationsLast90d: 1, npsScore: null, lastSeenDays: 1 })))
      .toBe("green");
  });

  it("grey default when nothing definitive", () => {
    expect(classifyHealth({ found: true, tags: [], conversationsLast90d: 0 }))
      .toBe("grey");
  });

  it("HEALTH_LABELS and HEALTH_DOTS expose every state", () => {
    for (const k of ["vip", "green", "yellow", "red", "grey"]) {
      expect(HEALTH_LABELS[k]).toBeTruthy();
      expect(HEALTH_DOTS[k]).toBeTruthy();
    }
  });
});

describe("stringifySnapshot", () => {
  it("produces 6–10 plain-text lines", () => {
    const out = stringifySnapshot(baseSnapshot({
      recentSummaries: [
        { title: "Integration broken" }, { title: "Billing q" }, { title: "Refund" }
      ]
    }));
    const lines = out.split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(6);
    expect(lines.length).toBeLessThanOrEqual(10);
    expect(out).toContain("Plan: Pro");
    expect(out).toContain("Tenure: 412 days");
    expect(out).toContain("Conversations in last 90 days: 4 (1 open)");
    expect(out).toContain("NPS: 6");
    expect(out).toContain("Tags: trial-extended");
    expect(out).toContain("Recent topics: Integration broken; Billing q; Refund");
    expect(out).not.toMatch(/[{}<>]/); // no JSON, no HTML
  });

  it("absent fields are skipped, not blanked", () => {
    const out = stringifySnapshot(baseSnapshot({
      plan: null, npsScore: null, tags: [], lastSeenDays: null
    }));
    expect(out).not.toMatch(/Plan:/);
    expect(out).not.toMatch(/NPS:/);
    expect(out).not.toMatch(/Tags:/);
    expect(out).not.toMatch(/Last seen:/);
  });

  it("found:false produces a one-liner", () => {
    expect(stringifySnapshot({ found: false, email: "x@y.co" }))
      .toMatch(/No Intercom record found for x@y.co/);
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
