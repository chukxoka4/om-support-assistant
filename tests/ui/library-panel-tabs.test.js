// Library & Learning section: tabs, pagination, filter chips, metric-tile jump.

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  // 25 entries: 18 seeds + 7 generated, so we exercise pagination + filters.
  const ENTRIES = [];
  for (let i = 0; i < 18; i++) {
    ENTRIES.push({
      id: `s${i}`, source: "seed",
      product: "OptinMonster",
      dropdowns: { goal: "g", audience: "a", tone: "t", mode: "m", concise: false },
      scenario_title: `Seed ${i}`, scenario_summary: `summary ${i}`,
      weighted_score: 100 - i // descending so order is predictable
    });
  }
  for (let i = 0; i < 7; i++) {
    ENTRIES.push({
      id: `g${i}`, source: "generated",
      product: "OptinMonster",
      dropdowns: { goal: "g", audience: "a", tone: "t", mode: "m", concise: false },
      scenario_title: `Generated ${i}`, scenario_summary: `gen summary ${i}`,
      weighted_score: 80 - i
    });
  }
  // 30 drafts to exercise pagination.
  const DRAFTS = Array.from({ length: 30 }, (_, i) => ({
    id: `d${i}`,
    ts: new Date(Date.UTC(2026, 3, 1 + i, 10)).toISOString(),
    conversation_id: `${1000 + i}`,
    product: "OptinMonster", goal: "x", mode: "y", tone: "z",
    provider: "claude",
    output_parsed: { versionA: `version A for draft ${i}` },
    draft_input: `draft ${i}`,
    outcome: null
  }));
  return { ENTRIES, DRAFTS };
});

vi.mock("../../lib/compose.js", () => ({ compose: vi.fn(async () => ({ error: "stub" })) }));
vi.mock("../../lib/library-rank.js", () => ({
  rankLexical: vi.fn(() => []), rankLLM: vi.fn(async () => [])
}));
vi.mock("../../lib/metrics.js", () => ({
  computeMetrics: vi.fn(async () => ({
    readyRate: null, managerRate: null,
    libraryCount: h.ENTRIES.length,
    totalDrafts: h.DRAFTS.length,
    quickTransforms: 0,
    pendingSuggestionCount: 0,
    sentAsIs: 0, managerApproved: 0, managerialRewrite: 0
  }))
}));
vi.mock("../../lib/library.js", async (orig) => ({
  ...(await orig()),
  getAllEntries: vi.fn(async () => h.ENTRIES.map((e) => ({ ...e }))),
  getAllPendingSuggestions: vi.fn(async () => [])
}));

function fixture() {
  return `
  <div id="sidepanelToasts" class="toasts"></div>
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
  <select id="goal"><option>g</option></select>
  <select id="mode"><option>m</option></select>
  <select id="audience"><option>a</option></select>
  <select id="tone"><option>t</option></select>
  <div id="providerRow" style="display:none"><select id="providerSelect"><option value="claude">claude</option></select></div>
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
    <select id="promptScope"><option value="personal">Personal</option><option value="team">Team</option></select>
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
    <div class="ll-tabs" id="llTabs">
      <button class="ll-tab is-active" data-tab="library">Library prompts</button>
      <button class="ll-tab" data-tab="review">Review queue</button>
      <button class="ll-tab" data-tab="drafts">Recent drafts</button>
    </div>
    <div data-tab-pane="library">
      <div id="libraryFilterChips">
        <button class="ll-chip is-active" data-filter="all">All</button>
        <button class="ll-chip" data-filter="seed">Seeds</button>
        <button class="ll-chip" data-filter="generated">Generated</button>
      </div>
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
  <span class="add-value-link" data-add="goals"></span>
  <span class="add-value-link" data-add="modes"></span>
  <span class="add-value-link" data-add="audiences"></span>
  <span class="add-value-link" data-add="tones"></span>
  `;
}

describe("Library & Learning: tabs, pagination, filter chips, tile jump", () => {
  beforeAll(async () => {
    document.body.innerHTML = fixture();
    chrome.windows.getCurrent = vi.fn(async () => ({ id: 42 }));
    await chrome.storage.local.set({ draft_log: h.DRAFTS });
    await import("../../sidepanel.js");
    // Section is default-expanded; init renders it. Wait for the awaits to drain.
    await new Promise((r) => setTimeout(r, 50));
  });

  beforeEach(async () => {
    // reset any state mutations between tests
  });

  it("Library tab is the default; pagination shows 10 of the 25 entries on page 1", async () => {
    const items = document.querySelectorAll(".library-item");
    expect(items.length).toBe(10);
    const paginator = document.getElementById("libraryPaginator");
    expect(paginator.textContent).toMatch(/page 1 of 3/);
  });

  it("Next button advances to page 2 of Library", async () => {
    document.querySelector("#libraryPaginator [data-pg=next]").click();
    await new Promise((r) => setTimeout(r, 20));
    expect(document.getElementById("libraryPaginator").textContent).toMatch(/page 2 of 3/);
  });

  it("Filter chip 'Seeds' shows only seeds, paginated", async () => {
    document.querySelector("#libraryFilterChips [data-filter=seed]").click();
    await new Promise((r) => setTimeout(r, 20));
    const titles = [...document.querySelectorAll(".library-item .li-title")].map((n) => n.textContent);
    expect(titles.every((t) => t.startsWith("Seed"))).toBe(true);
    // 18 seeds → 2 pages.
    expect(document.getElementById("libraryPaginator").textContent).toMatch(/page 1 of 2/);
  });

  it("Switching from Seeds to Generated resets page to 1 and shows only generated", async () => {
    // Advance Seeds to page 2 first.
    document.querySelector("#libraryPaginator [data-pg=next]").click();
    await new Promise((r) => setTimeout(r, 20));
    expect(document.getElementById("libraryPaginator").textContent).toMatch(/page 2 of 2/);
    // Now flip to Generated.
    document.querySelector("#libraryFilterChips [data-filter=generated]").click();
    await new Promise((r) => setTimeout(r, 20));
    const titles = [...document.querySelectorAll(".library-item .li-title")].map((n) => n.textContent);
    expect(titles.every((t) => t.startsWith("Generated"))).toBe(true);
    // 7 generated → 1 page; paginator collapses to empty.
    expect(document.getElementById("libraryPaginator").innerHTML).toBe("");
  });

  it("Recent drafts tab paginates 30 drafts → page 1 of 3", async () => {
    document.querySelector("#llTabs [data-tab=drafts]").click();
    await new Promise((r) => setTimeout(r, 20));
    expect(document.querySelector('[data-tab-pane="drafts"]').hidden).toBe(false);
    expect(document.querySelectorAll(".history-item").length).toBe(10);
    expect(document.getElementById("draftsPaginator").textContent).toMatch(/page 1 of 3/);
  });

  it("Clicking the Drafts (30d) metric tile switches to the Recent drafts tab", async () => {
    // Move back to Library tab first.
    document.querySelector("#llTabs [data-tab=library]").click();
    await new Promise((r) => setTimeout(r, 20));
    expect(document.querySelector('[data-tab-pane="library"]').hidden).toBe(false);
    // Click the "Drafts (30d)" tile (index 3).
    const drafts = document.querySelectorAll("#metricsGrid .metric")[3];
    drafts.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(document.querySelector('[data-tab-pane="drafts"]').hidden).toBe(false);
    expect(document.querySelector('[data-tab-pane="library"]').hidden).toBe(true);
  });

  it("Clicking the Suggestions metric tile switches to the Review queue tab", async () => {
    const suggestions = document.querySelectorAll("#metricsGrid .metric")[5];
    suggestions.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(document.querySelector('[data-tab-pane="review"]').hidden).toBe(false);
  });

  it("Non-navigable metric tiles (Ready-to-send, Manager approved, Quick transforms) don't get clickable affordance", async () => {
    const tiles = document.querySelectorAll("#metricsGrid .metric");
    expect(tiles[0].classList.contains("is-clickable")).toBe(false); // Ready-to-send
    expect(tiles[1].classList.contains("is-clickable")).toBe(false); // Manager approved
    expect(tiles[4].classList.contains("is-clickable")).toBe(false); // Quick transforms
    // The three navigable ones DO have it.
    expect(tiles[2].classList.contains("is-clickable")).toBe(true);  // Library prompts
    expect(tiles[3].classList.contains("is-clickable")).toBe(true);  // Drafts (30d)
    expect(tiles[5].classList.contains("is-clickable")).toBe(true);  // Suggestions
  });
});
