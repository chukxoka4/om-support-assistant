// End-to-end: drafts spanning multiple weeks with mixed outcome timestamps,
// run computeAuditMetricsForRange across arbitrary windows, assert each count
// is bucketed by the right timestamp.

import { describe, it, expect, beforeEach } from "vitest";
import { logDraft, updateDraft, getAllDrafts } from "../../lib/storage.js";
import { computeAuditMetricsForRange } from "../../lib/audit-metrics.js";

const w1 = ["2026-04-06T00:00:00.000Z", "2026-04-12T23:59:59.999Z"]; // Mon-Sun
const w2 = ["2026-04-13T00:00:00.000Z", "2026-04-19T23:59:59.999Z"];
const quarter = ["2026-04-01T00:00:00.000Z", "2026-06-30T23:59:59.999Z"];

async function seedDraft(id, ts) {
  await logDraft({
    id, ts, action_type: "compose", outcome: null, outcome_at: null,
    delivery_action: "copy"
  });
}

describe("report-range wiring (storage → metrics)", () => {
  beforeEach(async () => {
    await chrome.storage.local.clear();
  });

  it("draft generated week1, approved week2 lands in different windows", async () => {
    await seedDraft("d1", "2026-04-08T10:00:00.000Z"); // generated week1
    // Mock the outcome_at stamp by passing it explicitly.
    await updateDraft("d1", { outcome: "manager_approved", outcome_at: "2026-04-15T10:00:00.000Z" });
    const drafts = await getAllDrafts();

    const m1 = computeAuditMetricsForRange({ drafts, library: [], rangeStart: w1[0], rangeEnd: w1[1] });
    const m2 = computeAuditMetricsForRange({ drafts, library: [], rangeStart: w2[0], rangeEnd: w2[1] });

    expect(m1.counts.generated).toBe(1);
    expect(m1.counts.sent).toBe(0);
    expect(m2.counts.generated).toBe(0);
    expect(m2.counts.sent).toBe(1);
  });

  it("auto-stamped outcome_at via updateDraft is picked up by metrics", async () => {
    await seedDraft("d2", "2026-04-08T10:00:00.000Z");
    // Don't supply outcome_at — let storage stamp it.
    await updateDraft("d2", { outcome: "sent" });
    const drafts = await getAllDrafts();
    expect(drafts[0].outcome_at).toBeTruthy();

    // The auto-stamp uses Date.now(); use a range that includes "now".
    const now = Date.now();
    const oneDay = 24 * 3600 * 1000;
    const range = [new Date(now - oneDay).toISOString(), new Date(now + oneDay).toISOString()];
    const m = computeAuditMetricsForRange({ drafts, library: [], rangeStart: range[0], rangeEnd: range[1] });
    expect(m.counts.sent).toBe(1);
  });

  it("quarterly range aggregates many drafts correctly", async () => {
    // 5 drafts across April–June: 3 sent, 1 rewritten, 1 still pending.
    await seedDraft("a", "2026-04-05T10:00:00.000Z");
    await updateDraft("a", { outcome: "sent", outcome_at: "2026-04-06T10:00:00.000Z" });

    await seedDraft("b", "2026-04-20T10:00:00.000Z");
    await updateDraft("b", { outcome: "manager_approved", outcome_at: "2026-04-22T10:00:00.000Z" });

    await seedDraft("c", "2026-05-15T10:00:00.000Z");
    await updateDraft("c", { outcome: "sent", outcome_at: "2026-05-15T11:00:00.000Z" });

    await seedDraft("d", "2026-06-01T10:00:00.000Z");
    await updateDraft("d", { outcome: "managerial_rewrite", outcome_at: "2026-06-02T10:00:00.000Z" });

    await seedDraft("e", "2026-06-25T10:00:00.000Z"); // pending

    const drafts = await getAllDrafts();
    const m = computeAuditMetricsForRange({ drafts, library: [], rangeStart: quarter[0], rangeEnd: quarter[1] });
    expect(m.counts.generated).toBe(5);
    expect(m.counts.sent).toBe(3);
    expect(m.counts.rewritten).toBe(1);
    expect(m.counts.reachedOutcome).toBe(4);
    expect(m.readyToSend).toBe(75); // 3 / (3+1)
  });

  it("drafts without outcome_at do not appear in outcome counts but are counted as generated", async () => {
    await seedDraft("legacy", "2026-04-10T10:00:00.000Z");
    // Patch outcome directly via storage write — bypassing updateDraft to
    // simulate an old record that pre-dates the outcome_at field.
    const all = await getAllDrafts();
    all[0].outcome = "sent";
    await chrome.storage.local.set({ draft_log: all });

    const drafts = await getAllDrafts();
    expect(drafts[0].outcome_at).toBeFalsy();

    const m = computeAuditMetricsForRange({ drafts, library: [], rangeStart: w1[0], rangeEnd: w1[1] });
    expect(m.counts.generated).toBe(1);
    expect(m.counts.sent).toBe(0); // excluded — we don't know when it transitioned
  });
});
