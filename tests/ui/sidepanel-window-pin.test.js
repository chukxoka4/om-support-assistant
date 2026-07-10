// A: side panel pins its tab queries to the cached windowId, eliminating
//    the cross-monitor "currentWindow:true" focus drift.
// B: when Generate fires without a detectable OM ticket, a warn toast
//    surfaces so the orphan-draft case is loud, not silent.

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

vi.mock("../../lib/compose.js", () => ({
  // Throwing keeps the Generate handler in its catch path; we only care
  // about the pre-call branch (warn toast + getCurrentTicket flow).
  compose: vi.fn(async () => ({ error: "stub" }))
}));
vi.mock("../../lib/library-rank.js", () => ({
  rankLexical: vi.fn(() => []),
  rankLLM: vi.fn(async () => [])
}));
vi.mock("../../lib/metrics.js", () => ({ computeMetrics: vi.fn(() => ({})) }));
vi.mock("../../lib/library.js", async (orig) => ({
  ...(await orig()),
  getAllEntries: vi.fn(async () => [{ id: "x", scenario_title: "x", scenario_summary: "x", weighted_score: 1 }])
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
    <input type="text" id="reportAuthorName" />
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
  <div id="providerRow" style="display:none"><select id="providerSelect"><option value="claude">claude</option></select></div>
  <input type="checkbox" id="concise" />
  <div id="revisitCard" style="display:none"></div>
  <div id="customerHealth" hidden></div>
  <div id="hcTabs" hidden></div>
  <span id="hcDot"></span><span id="hcLabel"></span><span id="hcSummary"></span>
  <button id="hcRetry"></button><button id="hcToggle"></button>
  <div id="hcBody" hidden></div>
  <input id="hcManualEmail" />
  <button id="hcManualGo"></button>
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
  <button id="auditToggle"></button>
  <div id="auditPanel" style="display:none">
    <select id="promptScope">
      <option value="personal">Personal</option>
      <option value="team">Team</option>
    </select>
    <input id="promptWeekStart" /><input id="promptWeekEnd" /><input id="promptAgent" />
    <button id="promptGenerate"></button><button id="promptCopy"></button>
    <textarea id="promptOutput"></textarea>
    <div id="promptStatus"></div>
    <textarea id="auditPersonalJson"></textarea>
    <div id="auditPersonalStatus"></div>
    <div id="auditLiveMetrics"></div>
    <textarea id="auditTeamJson"></textarea>
    <div id="auditTeamStatus"></div>
    <input id="auditAsk" />
    <button id="auditGenerate"></button><button id="auditCopySlack"></button>
    <div id="auditGenerateStatus"></div>
  </div>
  <button id="libraryToggle"></button>
  <div id="historyPanel">
    <div id="metricsGrid"></div>
    <button id="exportHistory"></button><button id="clearHistory"></button>
    <div id="libraryList"></div><div id="suggestionList"></div><div id="historyList"></div>
  </div>
  <span class="add-value-link" data-add="goals"></span>
  <span class="add-value-link" data-add="modes"></span>
  <span class="add-value-link" data-add="audiences"></span>
  <span class="add-value-link" data-add="tones"></span>
  `;
}

describe("side panel: window pinning + warn-on-no-ticket", () => {
  beforeAll(async () => {
    document.body.innerHTML = fixture();
    // Pretend the panel was opened in window 42.
    chrome.windows.getCurrent = vi.fn(async () => ({ id: 42 }));
    await import("../../sidepanel.js");
    // Allow init's awaits to settle.
    await Promise.resolve();
    await Promise.resolve();
  });

  beforeEach(async () => {
    chrome.tabs.query.mockClear();
    // Generate bails early without an API key — stub one so the handler
    // reaches the conversationId branch under test.
    await chrome.storage.sync.set({ api_keys: { claude: "sk-ant-test" } });
    // Default: an OM ticket tab in window 42 is "active in own window".
    chrome.tabs.query.mockImplementation(async (filter) => {
      if (filter.windowId === 42 || filter.currentWindow) {
        return [{ id: 100, url: "https://om.wpsiteassist.com/conversation/41816", windowId: 42 }];
      }
      return [];
    });
  });

  it("tab queries pin to the cached windowId, not currentWindow:true", async () => {
    document.getElementById("draft").value = "long draft text " + "x".repeat(200);
    document.getElementById("generateBtn").click();
    await new Promise((r) => setTimeout(r, 30));

    const usedWindowId = chrome.tabs.query.mock.calls.some(
      ([f]) => f && f.windowId === 42 && !f.currentWindow
    );
    expect(usedWindowId).toBe(true);
  });

  it("warns via toast when getCurrentTicket returns no conversationId at Generate", async () => {
    // No tab in window 42 → no ticket detectable.
    chrome.tabs.query.mockImplementation(async () => []);
    document.body.querySelectorAll("#sidepanelToasts .toast").forEach((n) => n.remove());

    document.getElementById("draft").value = "long draft text " + "y".repeat(200);
    document.getElementById("generateBtn").click();
    await new Promise((r) => setTimeout(r, 30));

    const toasts = [...document.querySelectorAll("#sidepanelToasts .toast")];
    const hasWarn = toasts.some((t) => /No OM ticket detected/i.test(t.textContent));
    expect(hasWarn).toBe(true);
  });

  it("does NOT warn when a real OM ticket tab is active in own window", async () => {
    document.body.querySelectorAll("#sidepanelToasts .toast").forEach((n) => n.remove());
    document.getElementById("draft").value = "long draft text " + "z".repeat(200);
    document.getElementById("generateBtn").click();
    await new Promise((r) => setTimeout(r, 30));

    const toasts = [...document.querySelectorAll("#sidepanelToasts .toast")];
    const hasWarn = toasts.some((t) => /No OM ticket detected/i.test(t.textContent));
    expect(hasWarn).toBe(false);
  });
});
