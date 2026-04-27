// Audit metrics — pure aggregations from draft_log + library_v3.

import { describe, it, expect } from "vitest";
import {
  recentComposeDrafts,
  readyToSendRate,
  suggestionCtr,
  customerContextCoverage,
  suggestionResolutions,
  libraryState,
  librarySizeSeries,
  computeAuditMetrics
} from "../../lib/audit-metrics.js";

const NOW = Date.now();
const DAY = 24 * 3600 * 1000;
const ago = (days) => new Date(NOW - days * DAY).toISOString();

describe("recentComposeDrafts", () => {
  it("filters to compose-type within window", () => {
    const drafts = [
      { id: "1", ts: ago(1) },                                  // in
      { id: "2", ts: ago(1), action_type: "compose" },          // in
      { id: "3", ts: ago(1), action_type: "quick-retone" },     // out
      { id: "4", ts: ago(10) },                                 // out (window)
      { id: "5", ts: null }                                     // out (no ts)
    ];
    const out = recentComposeDrafts(drafts, 7, NOW);
    expect(out.map((d) => d.id)).toEqual(["1", "2"]);
  });

  it("safe on empty/null input", () => {
    expect(recentComposeDrafts([], 7, NOW)).toEqual([]);
    expect(recentComposeDrafts(null, 7, NOW)).toEqual([]);
  });
});

describe("readyToSendRate", () => {
  it("only counts drafts with an outcome; sent + manager_approved are 'ready'", () => {
    const drafts = [
      { outcome: "sent" },
      { outcome: "sent" },
      { outcome: "manager_approved" },
      { outcome: "managerial_rewrite" },
      { outcome: null }
    ];
    expect(readyToSendRate(drafts)).toBe(75); // 3/4 = 75% (null excluded)
  });

  it("returns null when nothing has an outcome", () => {
    expect(readyToSendRate([{ outcome: null }, {}])).toBeNull();
    expect(readyToSendRate([])).toBeNull();
  });
});

describe("suggestionCtr", () => {
  it("counts impressions + clicks", () => {
    const drafts = [
      { suggestion_log: { impression_ids: ["a", "b"], clicked_id: "a" } },
      { suggestion_log: { impression_ids: ["c"], clicked_id: null } },
      { suggestion_log: null },
      {}
    ];
    expect(suggestionCtr(drafts)).toEqual({
      total: 2, clicked: 1, ratePercent: 50
    });
  });

  it("returns null rate when no impressions", () => {
    expect(suggestionCtr([])).toEqual({ total: 0, clicked: 0, ratePercent: null });
  });
});

describe("customerContextCoverage", () => {
  it("counts customer_context_used:true", () => {
    const drafts = [
      { customer_context_used: true },
      { customer_context_used: true },
      { customer_context_used: false },
      {}
    ];
    expect(customerContextCoverage(drafts)).toEqual({
      total: 4, withContext: 2, ratePercent: 50
    });
  });
});

describe("suggestionResolutions", () => {
  it("tallies pending / applied / rejected / deferred + needs_manual", () => {
    const lib = [
      { pending_suggestions: [
        { status: "pending" },
        { status: "applied", resolved_at: ago(2) },
        { status: "applied", resolved_at: ago(20) }, // outside window
        { status: "rejected", resolved_at: ago(1) },
        { status: "deferred", resolved_at: ago(3) },
        { status: "needs_manual" }
      ] }
    ];
    const r = suggestionResolutions(lib, 7, NOW);
    expect(r).toEqual({
      pending: 1,
      needsManual: 1,
      appliedThisWeek: 1,
      rejectedThisWeek: 1,
      deferredThisWeek: 1,
      totalResolvedThisWeek: 3
    });
  });
});

describe("libraryState", () => {
  it("counts seeds, generated, refined, rewrites absorbed", () => {
    const lib = [
      { id: "1", source: "seed", created_at: ago(60), score: { rewrites_absorbed: 0 } },
      { id: "2", source: "generated", created_at: ago(2), score: { rewrites_absorbed: 3 }, last_used_at: ago(1) },
      { id: "3", source: "generated", created_at: ago(20), score: { rewrites_absorbed: 1 }, last_used_at: ago(20) }
    ];
    const out = libraryState(lib, [], 7, NOW);
    expect(out.total).toBe(3);
    expect(out.seedCount).toBe(1);
    expect(out.generatedCount).toBe(2);
    expect(out.addedThisWeek).toBe(1);
    expect(out.rewritesAbsorbedAllTime).toBe(4);
  });
});

describe("librarySizeSeries", () => {
  it("returns one point per day for the window", () => {
    const lib = [
      { created_at: ago(10) },
      { created_at: ago(5) },
      { created_at: ago(2) },
      { created_at: ago(0) }
    ];
    const out = librarySizeSeries(lib, 7, NOW);
    expect(out.length).toBe(7);
    // Final day should include all entries.
    expect(out[out.length - 1].y).toBeGreaterThanOrEqual(3);
    // Earlier days should have fewer.
    expect(out[0].y).toBeLessThanOrEqual(out[out.length - 1].y);
  });
});

describe("computeAuditMetrics integration", () => {
  it("returns the full shape", () => {
    const m = computeAuditMetrics({
      drafts: [
        { id: "1", ts: ago(1), outcome: "sent", customer_context_used: true,
          suggestion_log: { impression_ids: ["a"], clicked_id: "a" } }
      ],
      library: [
        { id: "L1", source: "seed", created_at: ago(60),
          score: { rewrites_absorbed: 0 }, pending_suggestions: [] }
      ]
    });
    expect(m).toHaveProperty("library");
    expect(m).toHaveProperty("librarySeries");
    expect(m).toHaveProperty("suggestions");
    expect(m).toHaveProperty("suggestionCtr");
    expect(m).toHaveProperty("customerContext");
    expect(m).toHaveProperty("readyToSend", 100);
    expect(m).toHaveProperty("composedThisWeek", 1);
  });
});
