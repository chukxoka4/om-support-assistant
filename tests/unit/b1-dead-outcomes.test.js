// Bug B1 — Remove dead outcomes (edited / rewrote) and correction_logged.
// They were referenced everywhere but never assigned. Locking the cleanup.

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  draftIsRevisitPending,
  isTerminalRevisitOutcome,
  logDraft
} from "../../lib/storage.js";
import { computeMetrics } from "../../lib/metrics.js";

// Stub the provider dispatcher before compose imports it.
vi.mock("../../providers/index.js", () => ({
  callLLM: async () => ({
    text: "REASON: r\nVERSION A: a\nVERSION B: b\nCLEAN_PROMPT: c\nSCENARIO_SUMMARY: s",
    provider: "test"
  })
}));

const { compose } = await import("../../lib/compose.js");
const { getAllDrafts } = await import("../../lib/storage.js");

describe("draftIsRevisitPending no longer reads correction_logged", () => {
  it("delivered draft with outcome=edited+correction_logged is still pending (the field is gone)", () => {
    expect(
      draftIsRevisitPending({
        delivery_action: "copy",
        outcome: "edited",
        correction_logged: true
      })
    ).toBe(true);
  });

  it("only the three real terminal outcomes resolve a delivered draft", () => {
    for (const outcome of ["sent", "manager_approved", "managerial_rewrite"]) {
      expect(
        draftIsRevisitPending({ delivery_action: "copy", outcome })
      ).toBe(false);
    }
  });

  it("isTerminalRevisitOutcome unchanged: only the three real outcomes", () => {
    expect(isTerminalRevisitOutcome("sent")).toBe(true);
    expect(isTerminalRevisitOutcome("manager_approved")).toBe(true);
    expect(isTerminalRevisitOutcome("managerial_rewrite")).toBe(true);
    expect(isTerminalRevisitOutcome("edited")).toBe(false);
    expect(isTerminalRevisitOutcome("rewrote")).toBe(false);
  });
});

describe("computeMetrics no longer returns edited / rewrote tiles", () => {
  beforeEach(async () => chrome.storage.local.clear());

  it("return shape omits edited and rewrote keys", async () => {
    const m = await computeMetrics(30);
    expect(m).not.toHaveProperty("edited");
    expect(m).not.toHaveProperty("rewrote");
  });

  it("the three real outcomes still tally correctly", async () => {
    const ts = new Date().toISOString();
    await logDraft({ id: "1", ts, outcome: "sent" });
    await logDraft({ id: "2", ts, outcome: "manager_approved" });
    await logDraft({ id: "3", ts, outcome: "managerial_rewrite" });
    await logDraft({ id: "4", ts, outcome: null });
    const m = await computeMetrics(30);
    expect(m.sentAsIs).toBe(1);
    expect(m.managerApproved).toBe(1);
    expect(m.managerialRewrite).toBe(1);
    expect(m.totalDrafts).toBe(4);
    expect(m.totalWithOutcome).toBe(3);
    // ready / manager rates: 3/3 accepted = 100%; (manager+managerial)/3 = 67%
    expect(m.readyRate).toBe(100);
    expect(m.managerRate).toBe(67);
  });
});

describe("compose draft record no longer includes correction_logged", () => {
  beforeEach(async () => {
    await chrome.storage.local.clear();
    // compose -> getProductDoc / getHouseStyle hit chrome-extension:// URLs.
    // Stub fetch with empty 200 responses so prompt building doesn't crash.
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      text: async () => "",
      json: async () => ({})
    }));
  });

  it("record written by compose has no correction_logged field", async () => {
    await compose({
      product: "OptinMonster",
      draft: "test draft",
      promptExtra: "",
      goal: "Account Issue",
      mode: "billing",
      audience: "Frustrated Customer",
      tone: "Calm",
      concise: false,
      provider: "test",
      libraryEntryId: null
    });
    const drafts = await getAllDrafts();
    expect(drafts).toHaveLength(1);
    const record = drafts[0];
    expect(record).not.toHaveProperty("correction_logged");
    expect(record).toHaveProperty("outcome", null);
    expect(record).toHaveProperty("final_used_verbatim", null);
  });
});
