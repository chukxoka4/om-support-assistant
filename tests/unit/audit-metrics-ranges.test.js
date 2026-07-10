// Range-based audit metrics — used by the report so users can pick arbitrary
// [from, to] ranges. Counts are split by the timestamp of the *event* they
// describe (generation vs outcome) so April 1 generation + April 6 approval
// shows up in two different week ranges, not one.

import { describe, it, expect } from "vitest";
import {
  generatedInRange,
  sentInRange,
  rewrittenInRange,
  suggestionResolutionsInRange,
  libraryStateInRange,
  librarySizeSeriesInRange,
  activitySeriesInRange,
  computeAuditMetricsForRange
} from "../../lib/audit-metrics.js";

const APR1 = "2026-04-01T10:00:00.000Z";
const APR3 = "2026-04-03T10:00:00.000Z";
const APR6 = "2026-04-06T10:00:00.000Z";
const APR8 = "2026-04-08T10:00:00.000Z";

const week1 = ["2026-03-30T00:00:00.000Z", "2026-04-05T23:59:59.999Z"];
const week2 = ["2026-04-06T00:00:00.000Z", "2026-04-12T23:59:59.999Z"];

describe("generatedInRange", () => {
  it("filters compose drafts by ts", () => {
    const drafts = [
      { id: "g1", ts: APR1 },                                  // week1
      { id: "g2", ts: APR6 },                                  // week2
      { id: "g3", ts: APR1, action_type: "quick-retone" },     // skip
      { id: "g4", ts: null }                                   // skip
    ];
    expect(generatedInRange(drafts, ...week1).map((d) => d.id)).toEqual(["g1"]);
    expect(generatedInRange(drafts, ...week2).map((d) => d.id)).toEqual(["g2"]);
  });
});

describe("sentInRange", () => {
  it("filters by outcome_at, includes sent and manager_approved", () => {
    const drafts = [
      { id: "s1", ts: APR1, outcome: "sent", outcome_at: APR1 },                  // w1
      { id: "s2", ts: APR1, outcome: "sent", outcome_at: APR6 },                  // w2 (cross-week)
      { id: "s3", ts: APR1, outcome: "manager_approved", outcome_at: APR3 },      // w1
      { id: "s4", ts: APR1, outcome: "managerial_rewrite", outcome_at: APR3 },    // skip
      { id: "s5", ts: APR1, outcome: "sent" }                                     // skip (no outcome_at)
    ];
    expect(sentInRange(drafts, ...week1).map((d) => d.id).sort()).toEqual(["s1", "s3"]);
    expect(sentInRange(drafts, ...week2).map((d) => d.id)).toEqual(["s2"]);
  });
});

describe("rewrittenInRange", () => {
  it("filters by outcome_at, only managerial_rewrite", () => {
    const drafts = [
      { id: "r1", ts: APR1, outcome: "managerial_rewrite", outcome_at: APR3 },
      { id: "r2", ts: APR1, outcome: "managerial_rewrite", outcome_at: APR8 },
      { id: "r3", ts: APR1, outcome: "sent", outcome_at: APR3 }
    ];
    expect(rewrittenInRange(drafts, ...week1).map((d) => d.id)).toEqual(["r1"]);
    expect(rewrittenInRange(drafts, ...week2).map((d) => d.id)).toEqual(["r2"]);
  });
});

describe("split-bucket independence", () => {
  it("a draft generated week1 and approved week2 contributes to both windows", () => {
    const draft = {
      id: "x", ts: APR1, outcome: "manager_approved", outcome_at: APR6
    };
    expect(generatedInRange([draft], ...week1).length).toBe(1);
    expect(generatedInRange([draft], ...week2).length).toBe(0);
    expect(sentInRange([draft], ...week1).length).toBe(0);
    expect(sentInRange([draft], ...week2).length).toBe(1);
  });
});

describe("suggestionResolutionsInRange", () => {
  it("tallies resolutions inside the range only", () => {
    const lib = [
      { pending_suggestions: [
        { status: "pending" },
        { status: "applied", resolved_at: APR1 },                 // w1
        { status: "applied", resolved_at: APR8 },                 // w2
        { status: "rejected", resolved_at: APR3 },                // w1
        { status: "deferred", resolved_at: APR6 },                // w2
        { status: "needs_manual" }
      ] }
    ];
    expect(suggestionResolutionsInRange(lib, ...week1)).toMatchObject({
      pending: 1,
      needsManual: 1,
      appliedInRange: 1,
      rejectedInRange: 1,
      deferredInRange: 0,
      totalResolvedInRange: 2
    });
    expect(suggestionResolutionsInRange(lib, ...week2)).toMatchObject({
      appliedInRange: 1,
      rejectedInRange: 0,
      deferredInRange: 1,
      totalResolvedInRange: 2
    });
  });
});

describe("libraryStateInRange", () => {
  it("counts entries added inside the range", () => {
    const lib = [
      { source: "seed", created_at: "2026-01-01T00:00:00Z", score: { rewrites_absorbed: 0 } },
      { source: "generated", created_at: APR3, score: { rewrites_absorbed: 2 } },
      { source: "generated", created_at: APR8, score: { rewrites_absorbed: 1 } }
    ];
    expect(libraryStateInRange(lib, ...week1)).toMatchObject({
      total: 3, addedInRange: 1, seedCount: 1, generatedCount: 2,
      rewritesAbsorbedAllTime: 3
    });
    expect(libraryStateInRange(lib, ...week2).addedInRange).toBe(1);
  });
});

describe("librarySizeSeriesInRange", () => {
  it("emits one point per day across the range", () => {
    const lib = [{ created_at: APR1 }, { created_at: APR6 }];
    const series = librarySizeSeriesInRange(lib, ...week1); // 7 days
    expect(series.length).toBe(7);
    expect(series[series.length - 1].y).toBeGreaterThanOrEqual(1);
  });
});

describe("activitySeriesInRange", () => {
  it("buckets generation by ts and outcomes by outcome_at", () => {
    const drafts = [
      { ts: APR1, outcome: "sent", outcome_at: APR3 },                        // gen Apr1, sent Apr3
      { ts: APR1, outcome: "managerial_rewrite", outcome_at: APR3 },          // gen Apr1, rewrite Apr3
      { ts: APR3, outcome: null }                                             // gen Apr3 only
    ];
    const series = activitySeriesInRange(drafts, ...week1);
    const apr1 = series.find((p) => p.x === "04-01");
    const apr3 = series.find((p) => p.x === "04-03");
    expect(apr1).toMatchObject({ generated: 2, sent: 0, rewritten: 0 });
    expect(apr3).toMatchObject({ generated: 1, sent: 1, rewritten: 1 });
  });
});

describe("computeAuditMetricsForRange", () => {
  it("returns split counts and the activity series", () => {
    const drafts = [
      { ts: APR1, outcome: "sent", outcome_at: APR3 },
      { ts: APR3, outcome: "manager_approved", outcome_at: APR6 },
      { ts: APR3, outcome: "managerial_rewrite", outcome_at: APR3 }
    ];
    const lib = [{ source: "seed", created_at: "2026-01-01", score: {}, pending_suggestions: [] }];
    const m = computeAuditMetricsForRange({ drafts, library: lib, rangeStart: week1[0], rangeEnd: week1[1] });
    expect(m.counts.generated).toBe(3); // all three generated in week1
    expect(m.counts.sent).toBe(1);      // only the Apr3 sent lands in week1; the Apr6 approval lands in week2
    expect(m.counts.rewritten).toBe(1);
    expect(m.counts.reachedOutcome).toBe(2);
    expect(m.readyToSend).toBe(50); // 1 sent / (1 sent + 1 rewritten)
    expect(m.activitySeries).toBeInstanceOf(Array);
    expect(m).toHaveProperty("library");
    expect(m).toHaveProperty("librarySeries");
    expect(m).toHaveProperty("suggestions");
  });

  it("handles an empty range gracefully", () => {
    const m = computeAuditMetricsForRange({
      drafts: [], library: [], rangeStart: week1[0], rangeEnd: week1[1]
    });
    expect(m.counts).toEqual({ generated: 0, sent: 0, rewritten: 0, reachedOutcome: 0 });
    expect(m.readyToSend).toBeNull();
  });
});
