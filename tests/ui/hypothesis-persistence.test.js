// Hypothesis textarea persists per-range under hypothesis_drafts in
// chrome.storage.local. Reopening the same week restores the bullets;
// switching to a different week clears the field unless that range was
// also populated.

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

vi.mock("../../lib/compose.js", () => ({ compose: vi.fn(async () => ({ error: "stub" })) }));
vi.mock("../../lib/library-rank.js", () => ({
  rankLexical: vi.fn(() => []), rankLLM: vi.fn(async () => [])
}));
vi.mock("../../lib/metrics.js", () => ({
  computeMetrics: vi.fn(async () => ({
    readyRate: null, managerRate: null, libraryCount: 0, totalDrafts: 0,
    quickTransforms: 0, pendingSuggestionCount: 0,
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
    <div id="auditPanel">
      <select id="promptScope"></select>
      <input id="promptWeekStart" /><input id="promptWeekEnd" /><input id="promptAgent" />
      <textarea id="promptHypotheses"></textarea>
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

describe("hypothesis persistence (per range)", () => {
  beforeAll(async () => {
    document.body.innerHTML = fixture();
    chrome.windows.getCurrent = vi.fn(async () => ({ id: 1 }));
    await import("../../sidepanel.js");
    await new Promise((r) => setTimeout(r, 50));
  });

  beforeEach(async () => {
    // beforeEach in chrome-mock reinstalls storage — seed it again here.
    await chrome.storage.local.set({
      hypothesis_drafts: {
        "2026-04-06_2026-04-12": "Users duplicate campaigns\nRefund policy unclear"
      }
    });
    // Reset textarea + dates so each test starts fresh.
    document.getElementById("promptHypotheses").value = "";
    document.getElementById("promptWeekStart").value = "2026-04-06";
    document.getElementById("promptWeekEnd").value = "2026-04-12";
  });

  it("restores stored hypotheses when the range loads", async () => {
    // Fire change to trigger loadHypothesesForRange.
    document.getElementById("promptWeekEnd").dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    const ta = document.getElementById("promptHypotheses");
    expect(ta.value).toContain("Users duplicate campaigns");
    expect(ta.value).toContain("Refund policy unclear");
  });

  it("debounce-saves typed text under the current range key", async () => {
    const ta = document.getElementById("promptHypotheses");
    ta.value = "Just one new hypothesis";
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 500));
    const { hypothesis_drafts } = await chrome.storage.local.get("hypothesis_drafts");
    expect(hypothesis_drafts["2026-04-06_2026-04-12"]).toBe("Just one new hypothesis");
  });

  it("clears the entry from storage when the textarea is emptied", async () => {
    const ta = document.getElementById("promptHypotheses");
    ta.value = "";
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 500));
    const { hypothesis_drafts } = await chrome.storage.local.get("hypothesis_drafts");
    expect(hypothesis_drafts["2026-04-06_2026-04-12"]).toBeUndefined();
  });

  it("loads a different stored value when the range changes", async () => {
    // Seed a different range.
    await chrome.storage.local.set({
      hypothesis_drafts: { "2026-05-04_2026-05-10": "Quarterly billing edge case" }
    });
    document.getElementById("promptWeekStart").value = "2026-05-04";
    document.getElementById("promptWeekEnd").value = "2026-05-10";
    document.getElementById("promptWeekEnd").dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    const ta = document.getElementById("promptHypotheses");
    expect(ta.value).toBe("Quarterly billing edge case");
  });
});
