// Bug D3 — Tighten findEquivalent so two scenarios that share dropdowns
// but differ in instruction text both survive.

import { describe, it, expect, beforeEach } from "vitest";
import {
  addEntry,
  findEquivalent,
  normaliseInstructionPrefix,
  getAllEntries
} from "../../lib/library.js";

const baseEntry = (id, instruction) => ({
  id,
  created_at: "2025-01-01T00:00:00Z",
  source: "seed",
  product: "OptinMonster",
  dropdowns: {
    goal: "Account Issue",
    audience: "Frustrated Customer",
    tone: "Calm",
    mode: "billing",
    concise: false
  },
  scenario_title: "t",
  scenario_summary: "s",
  scenario_instruction: instruction,
  score: { initial_uses: 0, sent_as_is: 0, manager_approved: 0, rewrites_absorbed: 0 },
  pending_suggestions: []
});

const sharedDropdowns = {
  goal: "Account Issue",
  audience: "Frustrated Customer",
  tone: "Calm",
  mode: "billing",
  concise: false
};

describe("normaliseInstructionPrefix", () => {
  it("lowercases, trims, collapses whitespace, slices 60 chars", () => {
    const long = "  Confirm  the   PLAN\n\tand charge date before quoting any refund eligibility detail.";
    const out = normaliseInstructionPrefix(long);
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out.startsWith("confirm the plan and charge date")).toBe(true);
    expect(out).not.toContain("\n");
    expect(out).not.toContain("\t");
  });

  it("returns empty string for nullish/empty", () => {
    expect(normaliseInstructionPrefix("")).toBe("");
    expect(normaliseInstructionPrefix(null)).toBe("");
    expect(normaliseInstructionPrefix(undefined)).toBe("");
  });

  it("two strings differing only in whitespace/case normalise equal", () => {
    expect(
      normaliseInstructionPrefix("Confirm Plan And Charge Date")
    ).toBe(
      normaliseInstructionPrefix("  CONFIRM   plan and charge date  ")
    );
  });
});

describe("findEquivalent: 6-field match", () => {
  beforeEach(async () => chrome.storage.local.clear());

  it("matches when product + dropdowns + instruction prefix all match", async () => {
    await addEntry(baseEntry("e1", "Confirm plan and charge date before quoting refund."));
    const hit = await findEquivalent({
      product: "OptinMonster",
      dropdowns: sharedDropdowns,
      scenarioInstruction: "Confirm plan and charge date before quoting refund."
    });
    expect(hit).not.toBeNull();
    expect(hit.id).toBe("e1");
  });

  it("does NOT match when dropdowns equal but instruction prefix differs", async () => {
    await addEntry(baseEntry("e1", "Confirm plan and charge date first."));
    const hit = await findEquivalent({
      product: "OptinMonster",
      dropdowns: sharedDropdowns,
      scenarioInstruction: "Walk customer through the cancellation flow step by step."
    });
    expect(hit).toBeNull();
  });

  it("two seed-style entries with identical dropdowns + different instructions both survive", async () => {
    await addEntry(baseEntry("e1", "Confirm plan and charge date first."));
    await addEntry(baseEntry("e2", "Walk customer through the cancellation flow."));
    const all = await getAllEntries();
    expect(all).toHaveLength(2);

    // Looking up either instruction returns its own entry, never collapsing.
    const hitA = await findEquivalent({
      product: "OptinMonster",
      dropdowns: sharedDropdowns,
      scenarioInstruction: "Confirm plan and charge date first."
    });
    const hitB = await findEquivalent({
      product: "OptinMonster",
      dropdowns: sharedDropdowns,
      scenarioInstruction: "Walk customer through the cancellation flow."
    });
    expect(hitA.id).toBe("e1");
    expect(hitB.id).toBe("e2");
  });

  it("matches when first 60 chars agree but full text differs past 60 chars", async () => {
    // 60-char prefix is the contract. Two entries that share the first 60
    // chars are still equivalent — by design, to absorb minor wording
    // tweaks beyond char 60 instead of exploding into near-duplicates.
    const prefix = "Confirm plan and charge date before quoting any refund detail";
    expect(prefix.length).toBeGreaterThanOrEqual(60);
    const a = prefix + " for the customer.";
    const b = prefix + " under all circumstances.";
    await addEntry(baseEntry("e1", a));
    const hit = await findEquivalent({
      product: "OptinMonster",
      dropdowns: sharedDropdowns,
      scenarioInstruction: b
    });
    expect(hit?.id).toBe("e1");
  });

  it("does not match across products even if everything else agrees", async () => {
    await addEntry({ ...baseEntry("e1", "same instruction"), product: "TrustPulse" });
    const hit = await findEquivalent({
      product: "OptinMonster",
      dropdowns: sharedDropdowns,
      scenarioInstruction: "same instruction"
    });
    expect(hit).toBeNull();
  });
});

describe("findEquivalent: legacy 5-field match (instruction omitted)", () => {
  beforeEach(async () => chrome.storage.local.clear());

  it("falls back to the original behaviour when scenarioInstruction is absent", async () => {
    await addEntry(baseEntry("e1", "anything"));
    const hit = await findEquivalent({
      product: "OptinMonster",
      dropdowns: sharedDropdowns
    });
    expect(hit?.id).toBe("e1");
  });
});
