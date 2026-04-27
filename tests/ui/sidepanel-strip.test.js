// Side panel: suggestion strip debounce, Clear → Lex ranker, expandable rows, incoming_selection.

import { describe, it, expect, beforeAll, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => {
  const ENTRY_A = {
    id: "row-a",
    scenario_title: "Refund within window",
    scenario_summary: "Customer asks for a refund",
    scenario_instruction: "Confirm plan and charge date before quoting any refund amount.",
    product: "OptinMonster",
    dropdowns: {
      goal: "Account Issue",
      audience: "Frustrated Customer",
      tone: "Calm",
      mode: "billing",
      concise: false,
    },
    weighted_score: 12,
  };
  const ENTRY_B = {
    id: "row-b",
    scenario_title: "Cancellation flow walkthrough",
    scenario_summary: "Step by step cancel",
    scenario_instruction: "Walk through cancellation screens slowly.",
    product: "OptinMonster",
    dropdowns: {
      goal: "Close Sale",
      audience: "Happy Customer",
      tone: "Calm",
      mode: "lifecycle",
      concise: false,
    },
    weighted_score: 0,
  };
  const ENTRIES = [ENTRY_A, ENTRY_B];
  const rankLexicalMock = vi.fn(() => [
    { entry: ENTRY_A, score: 24, reason: "dropdowns +16 · lexical +6 · weight +2" },
    { entry: ENTRY_B, score: 14, reason: "lexical +10" },
  ]);
  return { ENTRIES, rankLexicalMock };
});

vi.mock("../../lib/compose.js", () => ({
  compose: vi.fn(async () => ({ error: "stub", draftId: null })),
}));

vi.mock("../../lib/library-rank.js", () => ({
  rankLexical: (...args) => h.rankLexicalMock(...args),
  rankLLM: vi.fn(async () => []),
}));

vi.mock("../../lib/metrics.js", () => ({
  computeMetrics: vi.fn(() => ({})),
}));

vi.mock("../../lib/library.js", async (importOriginal) => {
  const lib = await importOriginal();
  return {
    ...lib,
    getAllEntries: vi.fn(async () => h.ENTRIES),
  };
});

function sidepanelFixtureHtml() {
  return `
  <div id="sidepanelToasts" class="toasts"></div>
  <button type="button" id="toggleSettings" class="settings-toggle">Settings</button>
  <div id="settingsSection" class="card">
    <input type="password" id="geminiKey" /><input type="password" id="claudeKey" /><input type="password" id="openaiKey" />
    <select id="defaultProvider"></select>
    <button id="exportLibrary"></button><button id="importLibrary"></button><input type="file" id="importFile" />
    <button id="importMerge"></button><button id="importReplace"></button><button id="importCancel"></button>
    <div id="importSummary"></div><div id="importMergeHint"></div><div id="importReplaceHint"></div>
    <div id="importConfirm" hidden></div><button id="resetLibrary"></button><button id="saveSettings"></button>
    <div id="settingsStatus" class="status"></div>
  </div>
  <select id="libraryPick"><option value="">— no preset —</option></select>
  <div id="libraryPickMeta" class="meta"></div>
  <select id="product"><option value="OptinMonster">OptinMonster</option></select>
  <textarea id="draft" class="large"></textarea>
  <textarea id="promptExtra"></textarea>
  <select id="goal"><option>Account Issue</option></select>
  <select id="mode"><option>billing</option></select>
  <select id="audience"><option>Frustrated Customer</option></select>
  <select id="tone"><option>Calm</option></select>
  <div id="providerRow" style="display:none"><select id="providerSelect"></select></div>
  <input type="checkbox" id="concise" />
  <div id="revisitCard" style="display:none"></div>
  <div id="suggestionStrip" class="suggestion-strip" hidden>
    <div class="ss-header">
      <span class="ss-rankers">
        <label><input type="radio" name="rankerMode" value="lexical" /> Lex</label>
        <label><input type="radio" name="rankerMode" value="llm" /> LLM</label>
      </span>
    </div>
    <div class="ss-body" id="ssBody"></div>
    <div class="ss-foot meta" id="ssFoot"></div>
  </div>
  <button id="generateBtn" type="button"></button>
  <button id="clearBtn" type="button">Clear</button>
  <div id="formStatus" class="status"></div>
  <div id="output"></div>
  <div id="stepOneSlot" style="display:none"></div>
  <button type="button" id="libraryToggle"></button>
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

describe("sidepanel suggestion strip", () => {
  beforeAll(async () => {
    document.body.innerHTML = sidepanelFixtureHtml();
    await import("../../sidepanel.js");
  });

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    h.rankLexicalMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("programmatic incoming_selection on draft schedules the ranker without a real input event", async () => {
    const fire = globalThis.__testFireChromeStorageLocalChange;
    expect(typeof fire).toBe("function");
    const text = "word ".repeat(20).trim();
    expect(text.length).toBeGreaterThanOrEqual(80);
    fire({
      incoming_selection: {
        newValue: { text, target: "draft", ts: Date.now() },
      },
    });
    await vi.advanceTimersByTimeAsync(650);
    await Promise.resolve();
    expect(h.rankLexicalMock).toHaveBeenCalled();
  });

  it("Clear resets ranker to Lex after LLM was selected", async () => {
    const { setRankerMode, getRankerMode } = await import("../../lib/storage.js");
    await setRankerMode("llm");
    const llm = document.querySelector('input[name="rankerMode"][value="llm"]');
    const lex = document.querySelector('input[name="rankerMode"][value="lexical"]');
    llm.checked = true;
    lex.checked = false;
    llm.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    expect(await getRankerMode()).toBe("llm");

    document.getElementById("clearBtn").click();
    await vi.waitFor(async () => {
      expect(await getRankerMode()).toBe("lexical");
    });
    expect(lex.checked).toBe(true);
    expect(llm.checked).toBe(false);
  });

  it("caret expand on row 1 then row 2 collapses the first preview", async () => {
    const draft = document.getElementById("draft");
    draft.value = "x".repeat(80);
    draft.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(650);
    await Promise.resolve();
    await Promise.resolve();

    const rows = document.querySelectorAll(".ss-row");
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const carets = document.querySelectorAll(".ss-caret");
    const ex0 = rows[0].querySelector(".ss-expand");
    const ex1 = rows[1].querySelector(".ss-expand");

    carets[0].click();
    expect(ex0.hidden).toBe(false);
    expect(rows[0].querySelector(".ss-expand-instruction")?.textContent).toMatch(/Confirm plan and charge date/);

    carets[1].click();
    expect(ex0.hidden).toBe(true);
    expect(ex1.hidden).toBe(false);
    expect(rows[1].querySelector(".ss-expand-instruction")?.textContent).toMatch(/Walk through cancellation/);
  });
});
