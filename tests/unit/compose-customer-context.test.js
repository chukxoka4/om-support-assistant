// F2 — compose folds customerContext into the user prompt under the
// "Customer context (Intercom):" header, and tags the draft record.

import { describe, it, expect, beforeEach, vi } from "vitest";

let capturedUser = null;

vi.mock("../../providers/index.js", () => ({
  callLLM: vi.fn(async ({ user }) => {
    capturedUser = user;
    return {
      text: "REASON: r\nVERSION A: a\nVERSION B: b\nCLEAN_PROMPT: c\nSCENARIO_SUMMARY: s",
      provider: "test"
    };
  })
}));

const { compose } = await import("../../lib/compose.js");
const { getAllDrafts } = await import("../../lib/storage.js");

const baseArgs = {
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

describe("compose customerContext", () => {
  beforeEach(async () => {
    await chrome.storage.local.clear();
    capturedUser = null;
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      text: async () => "",
      json: async () => ({})
    }));
  });

  it("when omitted, the user prompt has no Customer context block", async () => {
    await compose(baseArgs);
    expect(capturedUser).not.toMatch(/Customer context/);
    const drafts = await getAllDrafts();
    expect(drafts[0].customer_context_used).toBe(false);
  });

  it("when provided, the block lands above the draft section verbatim", async () => {
    const customerContext = `Email: jane@acme.com\nPlan: Pro\nNPS: 6`;
    await compose({ ...baseArgs, customerContext });
    expect(capturedUser).toContain("Customer context (Intercom):");
    expect(capturedUser).toContain("Email: jane@acme.com");
    expect(capturedUser).toContain("Plan: Pro");
    expect(capturedUser).toContain("NPS: 6");
    // Order: customer context appears before the draft section.
    const ctxIdx = capturedUser.indexOf("Customer context");
    const draftIdx = capturedUser.indexOf("Draft / customer message");
    expect(ctxIdx).toBeGreaterThan(-1);
    expect(draftIdx).toBeGreaterThan(ctxIdx);

    const drafts = await getAllDrafts();
    expect(drafts[0].customer_context_used).toBe(true);
  });

  it("empty / whitespace-only customerContext is ignored", async () => {
    await compose({ ...baseArgs, customerContext: "   \n  " });
    expect(capturedUser).not.toMatch(/Customer context/);
  });
});
