// Decides whether a draft_log change should re-fire the OM ticket page's
// revisit-prompt flow. Quick-transform writes must NOT trigger.

import { describe, it, expect } from "vitest";
import { shouldPromptForChange } from "../../lib/draft-log-changes.js";

const compose = (id, overrides = {}) => ({
  id, ts: "2026-04-30T10:00:00Z",
  conversation_id: "41816",
  delivery_action: null, outcome: null,
  ...overrides
});
const quickRetone = (id, overrides = {}) => ({
  id, ts: "2026-04-30T10:00:00Z",
  action_type: "quick-retone", action_id: "fix",
  conversation_id: "41816",
  ...overrides
});
const quickTranslate = (id) => ({
  id, ts: "2026-04-30T10:00:00Z",
  action_type: "quick-translate", action_id: "fr",
  conversation_id: "41816"
});

describe("shouldPromptForChange", () => {
  it("returns false when newArr is missing or non-array", () => {
    expect(shouldPromptForChange([], null)).toBe(false);
    expect(shouldPromptForChange([], undefined)).toBe(false);
    expect(shouldPromptForChange(null, "not-an-array")).toBe(false);
  });

  it("returns false when nothing changed", () => {
    const arr = [compose("a"), compose("b")];
    expect(shouldPromptForChange(arr, arr)).toBe(false);
  });

  it("returns false when only a quick-retone entry is appended", () => {
    const before = [compose("a")];
    const after = [compose("a"), quickRetone("q1")];
    expect(shouldPromptForChange(before, after)).toBe(false);
  });

  it("returns false when only a quick-translate entry is appended", () => {
    const before = [compose("a")];
    const after = [compose("a"), quickTranslate("q1")];
    expect(shouldPromptForChange(before, after)).toBe(false);
  });

  it("returns true when a new compose draft is appended", () => {
    const before = [compose("a")];
    const after = [compose("a"), compose("b")];
    expect(shouldPromptForChange(before, after)).toBe(true);
  });

  it("returns true when an existing compose entry's delivery_action changes", () => {
    const before = [compose("a", { delivery_action: null })];
    const after = [compose("a", { delivery_action: "copy" })];
    expect(shouldPromptForChange(before, after)).toBe(true);
  });

  it("returns false when only quick-transform metadata mutates", () => {
    const before = [compose("a"), quickRetone("q1", { outcome: null })];
    const after = [compose("a"), quickRetone("q1", { outcome: "noted" })];
    expect(shouldPromptForChange(before, after)).toBe(false);
  });

  it("batch: many quick transforms together → false", () => {
    const before = [compose("a")];
    const after = [
      compose("a"),
      quickRetone("q1"),
      quickRetone("q2"),
      quickTranslate("q3")
    ];
    expect(shouldPromptForChange(before, after)).toBe(false);
  });

  it("batch: a compose alongside quick transforms → true (compose wins)", () => {
    const before = [];
    const after = [
      quickRetone("q1"),
      compose("c1"),
      quickTranslate("q2")
    ];
    expect(shouldPromptForChange(before, after)).toBe(true);
  });

  it("entries with action_type:'compose' explicitly are still treated as compose", () => {
    const before = [];
    const after = [compose("a", { action_type: "compose" })];
    expect(shouldPromptForChange(before, after)).toBe(true);
  });
});
