// Options page: Claude Code "Test connection" + third-party gate + labelled
// default-provider select. Loads the real options.html and drives options.js.
//
// NOTE: options.js is an ES module imported once; its listeners bind to the DOM
// present at import time. So we load the DOM exactly once (beforeAll) and never
// replace it — otherwise fresh elements would have no handlers.

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("../../lib/library.js", async (orig) => ({
  ...(await orig()),
  getAllEntries: vi.fn(async () => []),
}));

const el = (id) => document.getElementById(id);
const defaultOptionValues = () => [...el("default-provider").options].map((o) => o.value);

describe("options: Claude Code connector + third-party gate", () => {
  beforeAll(async () => {
    const html = readFileSync(join(process.cwd(), "options.html"), "utf8");
    document.body.innerHTML = html.split("<body>")[1].split("</body>")[0].replace(/<script[\s\S]*?<\/script>/g, "");
    await import("../../options.js");
  });

  beforeEach(async () => {
    await chrome.storage.sync.clear();
    chrome.runtime.lastError = null;
  });

  it("Test connection success: green dot, status recorded, connector added to default select (labelled)", async () => {
    chrome.runtime.sendNativeMessage = (host, message, cb) => cb({ pong: true, ok: true, kb: true });
    el("test-claude-code").click();

    const { getClaudeCodeStatus } = await import("../../lib/storage.js");
    await vi.waitFor(async () => {
      const s = await getClaudeCodeStatus();
      expect(s).toMatchObject({ enabled: true, lastPingOk: true, kb: true });
    });
    await vi.waitFor(() => {
      expect(el("cc-dot").className).toMatch(/dot--ok/);
      const cc = [...el("default-provider").options].find((o) => o.value === "claude-code");
      expect(cc?.textContent).toBe("Claude (Enterprise)");
    });
    expect(el("cc-status-text").textContent).toMatch(/connected.*knowledge base/i);
    expect(el("cc-install-hint").hidden).toBe(true);
  });

  it("Test connection failure: red dot, error recorded, install hint shown, connector NOT offered", async () => {
    chrome.runtime.sendNativeMessage = (host, message, cb) => {
      chrome.runtime.lastError = { message: "Specified native messaging host not found." };
      cb(undefined);
      chrome.runtime.lastError = null;
    };
    el("test-claude-code").click();

    const { getClaudeCodeStatus } = await import("../../lib/storage.js");
    await vi.waitFor(async () => {
      expect((await getClaudeCodeStatus()).lastPingOk).toBe(false);
    });
    await vi.waitFor(() => {
      expect(el("cc-dot").className).toMatch(/dot--err/);
      expect(el("cc-install-hint").hidden).toBe(false);
      expect(defaultOptionValues()).not.toContain("claude-code");
    });
  });

  it("third-party toggle ON: shows fields + warning, persists allowThirdParty, reveals keyed providers", async () => {
    const { setApiKeys, getAllowThirdParty } = await import("../../lib/storage.js");
    await setApiKeys({ gemini: "g", claude: "", openai: "" });

    const toggle = el("allow-third-party");
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));

    await vi.waitFor(async () => {
      expect(await getAllowThirdParty()).toBe(true);
    });
    expect(el("third-party-fields").hidden).toBe(false);
    expect(el("third-party-warning").hidden).toBe(false);
    await vi.waitFor(() => {
      expect(defaultOptionValues()).toContain("gemini");
    });
  });

  it("third-party toggle OFF: hides fields, drops third-party providers from availability", async () => {
    const { setApiKeys, setAllowThirdParty } = await import("../../lib/storage.js");
    await setApiKeys({ gemini: "g", claude: "", openai: "" });
    await setAllowThirdParty(true);

    const toggle = el("allow-third-party");
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change"));

    await vi.waitFor(() => {
      expect(el("third-party-fields").hidden).toBe(true);
      expect(defaultOptionValues()).not.toContain("gemini");
    });
  });

  it("default select shows human labels and un-gated Claude on a key", async () => {
    // Realistic flow: type the key into the field, click Save (persists + re-renders).
    el("claude-key").value = "sk-ant";
    el("save").click();
    await vi.waitFor(() => {
      const claude = [...el("default-provider").options].find((o) => o.value === "claude");
      expect(claude?.textContent).toBe("Claude (API key)");
    });
    el("claude-key").value = "";
  });
});
