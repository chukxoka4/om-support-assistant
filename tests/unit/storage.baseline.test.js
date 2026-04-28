// Baseline test against current code. Locks behaviour so Phase A refactors
// are detected. Tests for the *post-A1* shape live in storage.test.js.

import { describe, it, expect, beforeEach } from "vitest";
import {
  isTerminalRevisitOutcome,
  draftIsRevisitPending,
  getTaxonomy,
  addTaxonomyValue,
} from "../../lib/storage.js";

describe("isTerminalRevisitOutcome", () => {
  it("returns true for the three real terminal outcomes", () => {
    expect(isTerminalRevisitOutcome("sent")).toBe(true);
    expect(isTerminalRevisitOutcome("manager_approved")).toBe(true);
    expect(isTerminalRevisitOutcome("managerial_rewrite")).toBe(true);
  });
  it("returns false for nullish and unknown outcomes", () => {
    expect(isTerminalRevisitOutcome(null)).toBe(false);
    expect(isTerminalRevisitOutcome(undefined)).toBe(false);
    expect(isTerminalRevisitOutcome("nope")).toBe(false);
  });
});

describe("draftIsRevisitPending", () => {
  it("false when no delivery_action", () => {
    expect(draftIsRevisitPending({})).toBe(false);
  });
  it("false when terminal outcome reached", () => {
    expect(
      draftIsRevisitPending({ delivery_action: "copy", outcome: "sent" })
    ).toBe(false);
  });
  it("true when delivered but no terminal outcome", () => {
    expect(draftIsRevisitPending({ delivery_action: "copy" })).toBe(true);
  });
});

describe("taxonomy", () => {
  beforeEach(async () => {
    await chrome.storage.local.clear();
  });
  it("returns defaults when nothing stored", async () => {
    const t = await getTaxonomy();
    expect(t.goals).toContain("Stop Churn");
    expect(t.modes).toContain("technical");
  });
  it("addTaxonomyValue persists and dedupes", async () => {
    await addTaxonomyValue("tones", "Cheeky");
    await addTaxonomyValue("tones", "Cheeky");
    const t = await getTaxonomy();
    const cheeky = t.tones.filter((x) => x === "Cheeky");
    expect(cheeky.length).toBe(1);
  });
});
