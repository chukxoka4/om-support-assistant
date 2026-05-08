// Live-refreshes the Library panel when the underlying library_v3 storage
// changes — so the Suggestions tile updates without reopening the panel.
// Boots sidepanel.js, mutates pending suggestion count via the metrics mock,
// fires a synthetic storage change, asserts the tile re-renders.

import { describe, it, expect, vi, beforeAll } from "vitest";

const pendingState = { count: 3 };

vi.mock("../../lib/compose.js", () => ({ compose: vi.fn(async () => ({ error: "stub" })) }));
vi.mock("../../lib/library-rank.js", () => ({
  rankLexical: vi.fn(() => []), rankLLM: vi.fn(async () => [])
}));
vi.mock("../../lib/metrics.js", () => ({
  computeMetrics: vi.fn(async () => ({
    readyRate: null, managerRate: null, libraryCount: 5, totalDrafts: 0,
    quickTransforms: 0, pendingSuggestionCount: pendingState.count,
    sentAsIs: 0, managerApproved: 0, managerialRewrite: 0
  }))
}));
vi.mock("../../lib/library.js", async (orig) => ({
  ...(await orig()),
  getAllEntries: vi.fn(async () => []),
  getAllPendingSuggestions: vi.fn(async () => [])
}));

function fixture() {
  return `
    <div id="sidepanelToasts"></div>
    <button id="toggleSettings"></button>
    <div id="settingsSection">
      <input type="password" id="geminiKey" /><input type="password" id="claudeKey" /><input type="password" id="openaiKey" />
      <select id="defaultProvider"></select>
      <input type="password" id="intercomKey" />
      <input type="text" id="reportAuthorName" />
      <button id="testIntercom"></button>
      <button id="exportLibrary"></button><button id="importLibrary"></button><input type="file" id="importFile" />
      <button id="resetLibrary"></button>
      <button id="importMerge"></button><button id="importReplace"></button><button id="importCancel"></button>
      <div id="importSummary"></div><div id="importMergeHint"></div><div id="importReplaceHint"></div>
      <div id="importConfirm" hidden></div>
      <button id="saveSettings"></button>
      <div id="settingsStatus"></div>
    </div>
    <select id="libraryPick"><option value="">— no preset —</option></select>
    <div id="libraryPickMeta"></div>
    <select id="product"><option value="OptinMonster">OptinMonster</option></select>
    <textarea id="draft"></textarea>
    <textarea id="promptExtra"></textarea>
    <select id="goal"></select><select id="mode"></select>
    <select id="audience"></select><select id="tone"></select>
    <div id="providerRow"><select id="providerSelect"></select></div>
    <input type="checkbox" id="concise" />
    <div id="revisitCard" style="display:none"></div>
    <div id="customerHealth" hidden></div>
    <div id="hcTabs" hidden></div>
    <span id="hcDot"></span><span id="hcLabel"></span><span id="hcSummary"></span>
    <button id="hcRetry"></button><button id="hcToggle"></button>
    <div id="hcBody" hidden></div>
    <input id="hcManualEmail" /><button id="hcManualGo"></button>
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
      <select id="promptScope"></select>
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
    <div id="historyPanel" class="open">
      <div class="metrics-grid" id="metricsGrid"></div>
      <button id="exportHistory"></button><button id="clearHistory"></button>
      <div class="ll-tabs" id="llTabs"></div>
      <div data-tab-pane="library">
        <div id="libraryFilterChips"></div>
        <div id="libraryList"></div>
        <div id="libraryPaginator"></div>
      </div>
      <div data-tab-pane="review" hidden>
        <div id="suggestionList"></div>
        <div id="suggestionPaginator"></div>
      </div>
      <div data-tab-pane="drafts" hidden>
        <div id="historyList"></div>
        <div id="draftsPaginator"></div>
      </div>
    </div>
  `;
}

describe("Suggestion tile live-refresh on library_v3 change", () => {
  beforeAll(async () => {
    document.body.innerHTML = fixture();
    chrome.windows.getCurrent = vi.fn(async () => ({ id: 1 }));
    await import("../../sidepanel.js");
    await new Promise((r) => setTimeout(r, 50));
  });

  it("renders the initial pending count", () => {
    expect(document.getElementById("metricsGrid").textContent).toContain("3");
  });

  it("re-renders when chrome.storage.onChanged fires for library_v3", async () => {
    pendingState.count = 11;
    globalThis.__testFireChromeStorageLocalChange({ library_v3: { newValue: [], oldValue: [] } });
    await new Promise((r) => setTimeout(r, 30));
    expect(document.getElementById("metricsGrid").textContent).toContain("11");
  });

  it("ignores irrelevant storage keys", async () => {
    pendingState.count = 99;
    globalThis.__testFireChromeStorageLocalChange({ unrelated: { newValue: 1 } });
    await new Promise((r) => setTimeout(r, 30));
    // Tile still shows 11 from the previous update — no re-render fired.
    expect(document.getElementById("metricsGrid").textContent).toContain("11");
    expect(document.getElementById("metricsGrid").textContent).not.toContain("99");
  });
});
