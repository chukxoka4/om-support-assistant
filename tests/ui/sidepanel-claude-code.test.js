// Side panel Settings must mirror the Options page: Claude Code connector
// (status + Test connection) and the third-party provider gate. This test locks
// that parity so the two surfaces don't drift.

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

vi.mock("../../lib/compose.js", () => ({ compose: vi.fn(async () => ({ error: "stub" })) }));
vi.mock("../../lib/library-rank.js", () => ({ rankLexical: vi.fn(() => []), rankLLM: vi.fn(async () => []) }));
vi.mock("../../lib/metrics.js", () => ({ computeMetrics: vi.fn(() => ({})) }));
vi.mock("../../lib/library.js", async (orig) => ({ ...(await orig()), getAllEntries: vi.fn(async () => []) }));

function fixture() {
  return `
  <div id="sidepanelToasts" class="toasts"></div>
  <button id="toggleSettings"></button>
  <div id="settingsSection">
    <span id="ccDot" class="dot"></span>
    <span id="ccStatusText"></span>
    <button id="testClaudeCode"></button>
    <div id="ccInstallHint" hidden></div>
    <input type="password" id="claudeKey" />
    <input type="checkbox" id="allowThirdParty" />
    <div id="thirdPartyWarning" hidden></div>
    <div id="thirdPartyFields" hidden>
      <input type="password" id="geminiKey" />
      <input type="password" id="openaiKey" />
    </div>
    <select id="defaultProvider"></select>
    <input type="password" id="intercomKey" />
    <button id="testIntercom"></button>
    <input type="text" id="reportAuthorName" />
    <button id="exportLibrary"></button>
    <button id="importLibrary"></button>
    <input type="file" id="importFile" />
    <button id="resetLibrary"></button>
    <button id="importMerge"></button>
    <button id="importReplace"></button>
    <button id="importCancel"></button>
    <div id="importSummary"></div>
    <div id="importMergeHint"></div>
    <div id="importReplaceHint"></div>
    <div id="importConfirm" hidden></div>
    <button id="saveSettings"></button>
    <div id="settingsStatus"></div>
  </div>
  <select id="libraryPick"><option value="">— no preset —</option></select>
  <div id="libraryPickMeta"></div>
  <select id="product"><option value="OptinMonster">OptinMonster</option></select>
  <textarea id="draft"></textarea>
  <textarea id="promptExtra"></textarea>
  <select id="goal"><option>Account Issue</option></select>
  <select id="mode"><option>billing</option></select>
  <select id="audience"><option>Frustrated Customer</option></select>
  <select id="tone"><option>Calm</option></select>
  <div id="providerRow" style="display:none"><select id="providerSelect"></select></div>
  <input type="checkbox" id="concise" />
  <div id="revisitCard" style="display:none"></div>
  <div id="suggestionStrip" hidden>
    <span class="ss-rankers">
      <input type="radio" name="rankerMode" value="lexical" />
      <input type="radio" name="rankerMode" value="llm" />
    </span>
    <div id="ssBody"></div><div id="ssFoot"></div>
  </div>
  <button id="generateBtn"></button>
  <button id="clearBtn"></button>
  <div id="formStatus"></div>
  <div id="output"></div>
  <div id="stepOneSlot" style="display:none"></div>
  <button id="libraryToggle"></button>
  <div id="historyPanel">
    <div id="metricsGrid"></div>
    <button id="exportHistory"></button>
    <button id="clearHistory"></button>
    <div id="libraryList"></div>
    <div id="suggestionList"></div>
    <div id="historyList"></div>
  </div>
  <span class="add-value-link" data-add="goals"></span>
  <span class="add-value-link" data-add="modes"></span>
  <span class="add-value-link" data-add="audiences"></span>
  <span class="add-value-link" data-add="tones"></span>
  `;
}

const el = (id) => document.getElementById(id);
const defaultOptionValues = () => [...el("defaultProvider").options].map((o) => o.value);

describe("side panel Settings: Claude Code connector + third-party gate", () => {
  beforeAll(async () => {
    document.body.innerHTML = fixture();
    await import("../../sidepanel.js");
  });

  beforeEach(async () => {
    await chrome.storage.sync.clear();
    chrome.runtime.lastError = null;
  });

  it("Test connection success records status and offers the labelled connector", async () => {
    chrome.runtime.sendNativeMessage = (host, message, cb) => cb({ pong: true, ok: true, kb: true });
    el("testClaudeCode").click();

    const { getClaudeCodeStatus } = await import("../../lib/storage.js");
    await vi.waitFor(async () => {
      expect((await getClaudeCodeStatus())).toMatchObject({ enabled: true, lastPingOk: true, kb: true });
    });
    await vi.waitFor(() => {
      expect(el("ccDot").className).toMatch(/dot--ok/);
      const cc = [...el("defaultProvider").options].find((o) => o.value === "claude-code");
      expect(cc?.textContent).toBe("Claude (Enterprise)");
    });
    expect(el("ccInstallHint").hidden).toBe(true);
  });

  it("Test connection failure shows the install hint and does not offer the connector", async () => {
    chrome.runtime.sendNativeMessage = (host, message, cb) => {
      chrome.runtime.lastError = { message: "host not found" };
      cb(undefined);
      chrome.runtime.lastError = null;
    };
    el("testClaudeCode").click();

    await vi.waitFor(() => {
      expect(el("ccDot").className).toMatch(/dot--err/);
      expect(el("ccInstallHint").hidden).toBe(false);
      expect(defaultOptionValues()).not.toContain("claude-code");
    });
  });

  it("third-party toggle gates Gemini/OpenAI visibility and availability", async () => {
    const { setApiKeys, getAllowThirdParty } = await import("../../lib/storage.js");
    await setApiKeys({ gemini: "g", claude: "", openai: "o" });

    const toggle = el("allowThirdParty");
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));
    await vi.waitFor(async () => {
      expect(await getAllowThirdParty()).toBe(true);
    });
    expect(el("thirdPartyFields").hidden).toBe(false);
    expect(el("thirdPartyWarning").hidden).toBe(false);
    await vi.waitFor(() => {
      expect(defaultOptionValues()).toEqual(expect.arrayContaining(["gemini", "openai"]));
    });

    toggle.checked = false;
    toggle.dispatchEvent(new Event("change"));
    await vi.waitFor(() => {
      expect(el("thirdPartyFields").hidden).toBe(true);
      expect(defaultOptionValues()).not.toContain("gemini");
    });
  });
});
