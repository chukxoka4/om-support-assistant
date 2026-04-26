// Bug A2 — Options Export / Import / Reset speak v3.

import { describe, it, expect, beforeEach } from "vitest";
import {
  getAllEntries,
  replaceAllEntries,
  clearAll
} from "../../lib/library.js";

const sampleEntry = (id) => ({
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
  scenario_instruction: "do the thing",
  score: { initial_uses: 0, sent_as_is: 0, manager_approved: 0, rewrites_absorbed: 0 },
  pending_suggestions: []
});

describe("replaceAllEntries", () => {
  beforeEach(async () => chrome.storage.local.clear());

  it("writes the entries and marks library_v3_seeded true", async () => {
    await replaceAllEntries([sampleEntry("a"), sampleEntry("b")]);
    const all = await getAllEntries();
    expect(all.map((e) => e.id).sort()).toEqual(["a", "b"]);
    const flag = await chrome.storage.local.get("library_v3_seeded");
    expect(flag.library_v3_seeded).toBe(true);
  });

  it("replaces previous contents wholesale", async () => {
    await replaceAllEntries([sampleEntry("a")]);
    await replaceAllEntries([sampleEntry("c"), sampleEntry("d")]);
    const all = await getAllEntries();
    expect(all.map((e) => e.id).sort()).toEqual(["c", "d"]);
  });
});

describe("clearAll", () => {
  beforeEach(async () => chrome.storage.local.clear());

  it("removes both library_v3 and library_v3_seeded", async () => {
    await replaceAllEntries([sampleEntry("a")]);
    await clearAll();
    const got = await chrome.storage.local.get(["library_v3", "library_v3_seeded"]);
    expect(got).toEqual({});
    expect(await getAllEntries()).toEqual([]);
  });
});

describe("import payload validation (mirrors options.js)", () => {
  // Replicates the validator in options.js so we can assert the rules
  // without standing up the full DOM. options.js is the only caller; if it
  // diverges, ui/options-import-export.test.js (later) will catch it.
  function validate(entry, idx) {
    if (!entry || typeof entry !== "object")
      throw new Error(`Entry ${idx}: not an object`);
    if (typeof entry.id !== "string" || !entry.id)
      throw new Error(`Entry ${idx}: missing id`);
    if (typeof entry.product !== "string" || !entry.product)
      throw new Error(`Entry ${idx}: missing product`);
    if (!entry.dropdowns || typeof entry.dropdowns !== "object")
      throw new Error(`Entry ${idx}: missing dropdowns`);
    if (typeof entry.scenario_instruction !== "string" || !entry.scenario_instruction)
      throw new Error(`Entry ${idx}: missing scenario_instruction`);
  }

  it("accepts a well-formed entry", () => {
    expect(() => validate(sampleEntry("a"), 0)).not.toThrow();
  });

  it("rejects missing id / product / dropdowns / instruction", () => {
    expect(() => validate({ ...sampleEntry("a"), id: "" }, 0)).toThrow(/missing id/);
    expect(() => validate({ ...sampleEntry("a"), product: "" }, 0)).toThrow(/missing product/);
    expect(() => validate({ ...sampleEntry("a"), dropdowns: null }, 0)).toThrow(/missing dropdowns/);
    expect(() => validate({ ...sampleEntry("a"), scenario_instruction: "" }, 0))
      .toThrow(/missing scenario_instruction/);
  });
});

describe("export → clear → import round-trip", () => {
  beforeEach(async () => chrome.storage.local.clear());

  it("library matches after a full round-trip", async () => {
    const original = [sampleEntry("a"), sampleEntry("b"), sampleEntry("c")];
    await replaceAllEntries(original);
    const exported = await getAllEntries();

    await clearAll();
    expect(await getAllEntries()).toEqual([]);

    // Strip the computed weighted_score that getAllEntries adds; import takes raw.
    const payload = exported.map(({ weighted_score, ...rest }) => rest);
    await replaceAllEntries(payload);

    const reloaded = await getAllEntries();
    expect(reloaded.map((e) => e.id).sort()).toEqual(["a", "b", "c"]);
  });
});
