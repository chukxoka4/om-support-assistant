// Bug D2 — Validate CLEAN_PROMPT for PII before auto-saving to library.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { detectPII } from "../../lib/compose.js";

describe("detectPII pure helper", () => {
  it("flags emails", () => {
    expect(detectPII("contact support@acme.com soon")).toEqual(["email"]);
  });
  it("flags ticket refs (4+ digits with #)", () => {
    expect(detectPII("see ticket #48291")).toEqual(["ticket_ref"]);
    expect(detectPII("issue #99 short")).toEqual([]); // 3 digits, ignored
  });
  it("flags URLs (http and https)", () => {
    expect(detectPII("visit https://example.com/foo")).toEqual(["url"]);
    expect(detectPII("see http://x.test/y")).toEqual(["url"]);
  });
  it("returns empty for clean text", () => {
    expect(detectPII("Confirm plan and charge date before quoting any refund.")).toEqual([]);
  });
  it("returns multiple hit names when several patterns match", () => {
    const hits = detectPII("email a@b.co and ticket #1234 and https://x.test");
    expect(hits).toEqual(["email", "ticket_ref", "url"]);
  });
  it("scans across all string args", () => {
    expect(detectPII("clean", "but second has a@b.co")).toEqual(["email"]);
  });
  it("ignores nullish args without crashing", () => {
    expect(detectPII(null, undefined, "")).toEqual([]);
  });
});

// Compose-level integration: stub the provider, prove auto-add is blocked.
vi.mock("../../providers/index.js", () => ({
  callLLM: vi.fn(async () => ({ text: globalThis.__llmText, provider: "test" }))
}));

const { compose } = await import("../../lib/compose.js");
const { getAllEntries } = await import("../../lib/library.js");

function fakeOutput({ versionA = "rewrite a", versionB = "rewrite b", reason = "ok", cleanPrompt, scenarioSummary }) {
  return [
    `REASON: ${reason}`,
    `VERSION A: ${versionA}`,
    `VERSION B: ${versionB}`,
    `CLEAN_PROMPT: ${cleanPrompt}`,
    `SCENARIO_SUMMARY: ${scenarioSummary}`
  ].join("\n");
}

const composeArgs = {
  product: "OptinMonster",
  draft: "rough",
  promptExtra: "",
  goal: "Account Issue",
  mode: "billing",
  audience: "Frustrated Customer",
  tone: "Calm",
  concise: false,
  provider: "test",
  libraryEntryId: null
};

describe("compose: auto-add to library is blocked when PII detected", () => {
  beforeEach(async () => {
    await chrome.storage.local.clear();
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      text: async () => "",
      json: async () => ({})
    }));
  });

  it("clean prompt → entry is added (baseline)", async () => {
    globalThis.__llmText = fakeOutput({
      cleanPrompt: "Confirm plan before quoting any refund.",
      scenarioSummary: "Standard refund flow."
    });
    const result = await compose(composeArgs);
    expect(result.librarySkipped).toBeNull();
    expect((await getAllEntries()).length).toBe(1);
  });

  it("email in cleanPrompt → not added; result.librarySkipped reports it", async () => {
    globalThis.__llmText = fakeOutput({
      cleanPrompt: "Reply to support@acme.com first.",
      scenarioSummary: "Refund flow."
    });
    const result = await compose(composeArgs);
    expect(result.librarySkipped?.reason).toBe("pii_detected");
    expect(result.librarySkipped.hits).toContain("email");
    expect((await getAllEntries()).length).toBe(0);
  });

  it("ticket ref in scenarioSummary → not added", async () => {
    globalThis.__llmText = fakeOutput({
      cleanPrompt: "Standard prompt.",
      scenarioSummary: "Customer raised in ticket #48291."
    });
    const result = await compose(composeArgs);
    expect(result.librarySkipped?.hits).toContain("ticket_ref");
    expect((await getAllEntries()).length).toBe(0);
  });

  it("URL in cleanPrompt → not added", async () => {
    globalThis.__llmText = fakeOutput({
      cleanPrompt: "Send them to https://app.acme.com/settings.",
      scenarioSummary: "Settings walkthrough."
    });
    const result = await compose(composeArgs);
    expect(result.librarySkipped?.hits).toContain("url");
    expect((await getAllEntries()).length).toBe(0);
  });

  it("two rewrites still come back even when library skipped", async () => {
    globalThis.__llmText = fakeOutput({
      versionA: "polished reply",
      versionB: "revamped reply",
      cleanPrompt: "Email support@x.com.",
      scenarioSummary: "x"
    });
    const result = await compose(composeArgs);
    expect(result.librarySkipped).toBeTruthy();
    expect(result.parsed.versionA).toBe("polished reply");
    expect(result.parsed.versionB).toBe("revamped reply");
  });
});
