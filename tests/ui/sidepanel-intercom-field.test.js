// Side panel: Intercom key field mirrors Options. Save persists, Test calls /me.

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

vi.mock("../../lib/compose.js", () => ({
  compose: vi.fn(async () => ({ error: "stub" }))
}));
vi.mock("../../lib/library-rank.js", () => ({
  rankLexical: vi.fn(() => []),
  rankLLM: vi.fn(async () => [])
}));
vi.mock("../../lib/metrics.js", () => ({ computeMetrics: vi.fn(() => ({})) }));
vi.mock("../../lib/library.js", async (orig) => ({
  ...(await orig()),
  getAllEntries: vi.fn(async () => [])
}));

function fixture() {
  return `
  <div id="sidepanelToasts" class="toasts"></div>
  <button id="toggleSettings"></button>
  <div id="settingsSection">
    <input type="password" id="geminiKey" />
    <input type="password" id="claudeKey" />
    <input type="password" id="openaiKey" />
    <select id="defaultProvider"></select>
    <input type="password" id="intercomKey" />
    <button id="testIntercom"></button>
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

describe("side panel: Intercom field", () => {
  beforeAll(async () => {
    document.body.innerHTML = fixture();
    await import("../../sidepanel.js");
  });

  beforeEach(async () => {
    await chrome.storage.sync.clear();
    document.getElementById("intercomKey").value = "";
  });

  it("Save persists the Intercom key via setIntercomConfig", async () => {
    const { getIntercomConfig } = await import("../../lib/storage.js");
    document.getElementById("intercomKey").value = "tok_xyz";
    document.getElementById("saveSettings").click();
    await vi.waitFor(async () => {
      expect((await getIntercomConfig()).apiKey).toBe("tok_xyz");
    });
  });

  it("Test button without a key surfaces a 'enter a key first' toast", async () => {
    document.getElementById("intercomKey").value = "";
    document.getElementById("testIntercom").click();
    await vi.waitFor(() => {
      const toasts = document.querySelectorAll("#sidepanelToasts .toast");
      expect([...toasts].some((t) => /enter an intercom key/i.test(t.textContent))).toBe(true);
    });
  });
});
