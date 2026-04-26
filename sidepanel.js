import { compose } from "./lib/compose.js";
import {
  getApiKeys, setApiKeys,
  getDefaultProvider, setDefaultProvider, getAvailableProviders,
  getTaxonomy, addTaxonomyValue,
  getAllDrafts, updateDraft,
  getUnresolvedDeliveredByConversation,
  draftIsRevisitPending
} from "./lib/storage.js";
import { computeMetrics } from "./lib/metrics.js";
import {
  getAllEntries, getAllPendingSuggestions, bumpScore, resolveSuggestion, getEntry,
  replaceAllEntries, clearAll, seedIfEmpty
} from "./lib/library.js";
import { diffImport, mergeNewOnly } from "./lib/library-import.js";
import { chosenAssistantReply } from "./lib/revisit-helpers.js";

const el = (id) => document.getElementById(id);
const state = {
  lastDraftId: null,
  lastParsed: null,
  lastLibraryEntryId: null,
  lastFocusedField: "draft",      // "draft" | "prompt"
  rewriteOf: null,               // draft id being rewritten
  /** Hide revisit UI for this conversation until you open a different ticket (session only). */
  revisitHiddenConversationId: null,
  /** Managerial rewrite textarea open for this draft id. */
  revisitMgrRewriteDraftId: null
};

// Track which of the two input fields was focused last, for routing
// "Send to Draft/Prompt" context-menu actions when focus has drifted.
for (const id of ["draft", "promptExtra"]) {
  document.addEventListener("DOMContentLoaded", () => {
    const node = el(id);
    if (!node) return;
    node.addEventListener("focus", () => {
      state.lastFocusedField = id === "draft" ? "draft" : "prompt";
    });
  });
}

function spliceAtCursor(textarea, text) {
  if (!textarea) return;
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);
  const needsLeadingSpace = before && !/\s$/.test(before) ? " " : "";
  const insertion = needsLeadingSpace + text;
  textarea.value = before + insertion + after;
  const newPos = start + insertion.length;
  textarea.focus();
  textarea.setSelectionRange(newPos, newPos);
}

// ---------- form helpers ----------
function getFormValues() {
  return {
    product: el("product").value,
    draft: el("draft").value,
    promptExtra: el("promptExtra").value,
    goal: el("goal").value,
    mode: el("mode").value,
    audience: el("audience").value,
    tone: el("tone").value,
    concise: el("concise").checked,
    provider: el("providerSelect")?.value || null,
    libraryEntryId: el("libraryPick").value || null
  };
}

function setDropdowns({ goal, audience, tone, mode, concise }) {
  if (goal) el("goal").value = goal;
  if (audience) el("audience").value = audience;
  if (tone) el("tone").value = tone;
  if (mode) el("mode").value = mode;
  el("concise").checked = !!concise;
}

function setStatus(node, msg, cls = "") {
  node.textContent = msg;
  node.className = `status ${cls}`;
}

// ---------- settings ----------
el("toggleSettings").addEventListener("click", () => {
  el("settingsSection").classList.toggle("open");
});

async function loadSettings() {
  const keys = await getApiKeys();
  el("geminiKey").value = keys.gemini || "";
  el("claudeKey").value = keys.claude || "";
  el("openaiKey").value = keys.openai || "";
  await refreshProviderSelects();
}

async function refreshProviderSelects() {
  const available = await getAvailableProviders();
  const current = await getDefaultProvider();
  const defaultSel = el("defaultProvider");
  defaultSel.innerHTML = "";
  if (!available.length) {
    defaultSel.innerHTML = "<option>— no providers configured —</option>";
  } else {
    for (const p of available) {
      const opt = document.createElement("option");
      opt.value = p; opt.textContent = p;
      if (p === current) opt.selected = true;
      defaultSel.appendChild(opt);
    }
  }
  const providerRow = el("providerRow");
  const providerSelect = el("providerSelect");
  providerSelect.innerHTML = "";
  if (available.length > 1) {
    providerRow.style.display = "";
    for (const p of available) {
      const opt = document.createElement("option");
      opt.value = p; opt.textContent = p;
      if (p === current) opt.selected = true;
      providerSelect.appendChild(opt);
    }
  } else {
    providerRow.style.display = "none";
  }
}

// ---------- library export / import / reset (mirrors options.js) ----------
let pendingLibraryImport = null; // { entries, diff }

function setSettingsStatus(text, kind = "ok") {
  setStatus(el("settingsStatus"), text, kind);
}

function validateLibraryEntry(entry, idx) {
  if (!entry || typeof entry !== "object")
    throw new Error(`Entry ${idx}: not an object`);
  if (typeof entry.id !== "string" || !entry.id)
    throw new Error(`Entry ${idx}: missing id`);
  if (typeof entry.product !== "string" || !entry.product)
    throw new Error(`Entry ${idx}: missing product`);
  if (!entry.dropdowns || typeof entry.dropdowns !== "object")
    throw new Error(`Entry ${idx}: missing dropdowns`);
  if (typeof entry.scenario_instruction !== "string" || !entry.scenario_instruction)
    throw new Error(`Entry ${idx}: missing scenario_instruction`);
}

function renderLibraryImportConfirm(diff) {
  el("importSummary").innerHTML = `
    File: <b>${diff.incomingTotal}</b> entries · You have <b>${diff.currentTotal}</b>.<br>
    <b>${diff.toAdd.length}</b> new ·
    <b>${diff.sameAsLocal.length}</b> identical ·
    <b>${diff.conflicts.length}</b> conflicting.`;
  el("importMergeHint").textContent =
    `Merge: adds ${diff.toAdd.length} new. Existing entries (and scores) untouched.`;
  el("importReplaceHint").textContent =
    `Replace: drops your ${diff.currentTotal} entries. Scores reset.`;
  el("importConfirm").hidden = false;
}

function closeLibraryImportConfirm() {
  el("importConfirm").hidden = true;
  pendingLibraryImport = null;
}

el("exportLibrary").addEventListener("click", async () => {
  try {
    const [library, drafts] = await Promise.all([getAllEntries(), getAllDrafts()]);
    const payload = {
      exported_at: new Date().toISOString(),
      version: 3,
      library,
      drafts
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `om-assistant-library-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setSettingsStatus(`Exported ${library.length} entries.`, "ok");
  } catch (err) {
    setSettingsStatus(`Export failed: ${err.message}`, "err");
  }
});

el("importLibrary").addEventListener("click", () => el("importFile").click());

el("importFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = "";
  try {
    const parsed = JSON.parse(await file.text());
    if (parsed.version !== 3) throw new Error(`Unsupported version: ${parsed.version}`);
    if (!Array.isArray(parsed.library)) throw new Error("Missing library array");
    parsed.library.forEach(validateLibraryEntry);
    const current = await getAllEntries();
    const diff = diffImport(current, parsed.library);
    pendingLibraryImport = { entries: parsed.library, diff };
    renderLibraryImportConfirm(diff);
    setSettingsStatus(`Loaded ${parsed.library.length} entries — confirm below.`, "ok");
  } catch (err) {
    closeLibraryImportConfirm();
    setSettingsStatus(`Import failed: ${err.message}`, "err");
  }
});

el("importMerge").addEventListener("click", async () => {
  if (!pendingLibraryImport) return;
  try {
    const current = await getAllEntries();
    const merged = mergeNewOnly(
      current.map(({ weighted_score, ...rest }) => rest),
      pendingLibraryImport.entries
    );
    await replaceAllEntries(merged);
    setSettingsStatus(
      `Merged: added ${pendingLibraryImport.diff.toAdd.length} new entries.`,
      "ok"
    );
  } catch (err) {
    setSettingsStatus(`Merge failed: ${err.message}`, "err");
  } finally {
    closeLibraryImportConfirm();
    await renderLibraryPicker();
  }
});

el("importReplace").addEventListener("click", async () => {
  if (!pendingLibraryImport) return;
  try {
    await replaceAllEntries(pendingLibraryImport.entries);
    setSettingsStatus(
      `Replaced: now ${pendingLibraryImport.entries.length} entries.`,
      "ok"
    );
  } catch (err) {
    setSettingsStatus(`Replace failed: ${err.message}`, "err");
  } finally {
    closeLibraryImportConfirm();
    await renderLibraryPicker();
  }
});

el("importCancel").addEventListener("click", () => {
  closeLibraryImportConfirm();
  setSettingsStatus("Import cancelled.", "ok");
});

el("resetLibrary").addEventListener("click", async () => {
  try {
    await clearAll();
    const result = await seedIfEmpty();
    setSettingsStatus(`Reset to seeds (${result.count || 0} entries).`, "ok");
    await renderLibraryPicker();
  } catch (err) {
    setSettingsStatus(`Reset failed: ${err.message}`, "err");
  }
});

el("saveSettings").addEventListener("click", async () => {
  await setApiKeys({
    gemini: el("geminiKey").value.trim(),
    claude: el("claudeKey").value.trim(),
    openai: el("openaiKey").value.trim()
  });
  const chosen = el("defaultProvider").value;
  if (chosen && chosen !== "— no providers configured —") await setDefaultProvider(chosen);
  await refreshProviderSelects();
  setStatus(el("settingsStatus"), "Saved.", "ok");
  setTimeout(() => setStatus(el("settingsStatus"), ""), 1500);
});

// ---------- taxonomy (extensible dropdowns) ----------
const SELECT_FIELDS = [
  { id: "goal", key: "goals" },
  { id: "audience", key: "audiences" },
  { id: "tone", key: "tones" },
  { id: "mode", key: "modes" }
];

async function renderDropdowns() {
  const tax = await getTaxonomy();
  for (const { id, key } of SELECT_FIELDS) {
    const sel = el(id);
    const current = sel.value;
    sel.innerHTML = "";
    for (const v of tax[key] || []) {
      const opt = document.createElement("option");
      opt.value = v; opt.textContent = v;
      sel.appendChild(opt);
    }
    if (current && tax[key]?.includes(current)) sel.value = current;
  }
}

document.querySelectorAll(".add-value-link").forEach((link) => {
  link.addEventListener("click", async () => {
    const key = link.dataset.add;
    const v = prompt(`New ${key.slice(0, -1)}?`);
    if (!v || !v.trim()) return;
    await addTaxonomyValue(key, v.trim());
    await renderDropdowns();
    const match = SELECT_FIELDS.find((f) => f.key === key);
    if (match) el(match.id).value = v.trim();
  });
});

// ---------- library picker ----------
async function renderLibraryPicker() {
  const pick = el("libraryPick");
  const entries = (await getAllEntries()).sort((a, b) => b.weighted_score - a.weighted_score);
  pick.innerHTML = '<option value="">— no preset —</option>';
  for (const e of entries) {
    const opt = document.createElement("option");
    opt.value = e.id;
    const score = e.weighted_score ? ` · ${Math.round(e.weighted_score)}` : "";
    opt.textContent = `${e.scenario_title}${score}`;
    pick.appendChild(opt);
  }
}

el("libraryPick").addEventListener("change", async (e) => {
  const id = e.target.value;
  const meta = el("libraryPickMeta");
  if (!id) { meta.textContent = ""; return; }
  const entry = await getEntry(id);
  if (!entry) return;
  setDropdowns(entry.dropdowns);
  el("product").value = entry.product;
  meta.textContent = entry.scenario_summary;
});

// ---------- incoming selection (cursor-aware append) ----------
function applyIncomingSelection(sel) {
  if (!sel?.text) return;
  const target = sel.target === "prompt" ? "prompt" : (sel.target === "draft" ? "draft" : state.lastFocusedField);
  const node = target === "prompt" ? el("promptExtra") : el("draft");
  spliceAtCursor(node, sel.text);
  state.lastFocusedField = target;
}

async function consumeIncomingSelection() {
  const { incoming_selection } = await chrome.storage.local.get("incoming_selection");
  if (!incoming_selection) return;
  if (Date.now() - incoming_selection.ts > 60_000) {
    await chrome.storage.local.remove("incoming_selection");
    return;
  }
  applyIncomingSelection(incoming_selection);
  await chrome.storage.local.remove("incoming_selection");
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.incoming_selection?.newValue) {
    applyIncomingSelection(changes.incoming_selection.newValue);
    chrome.storage.local.remove("incoming_selection");
  }
  if (changes.last_ticket_opened?.newValue) {
    renderRevisitCard().catch(() => {});
    refreshStepOneSlot().catch(() => {});
  }
  if (changes.revisit_pending_action?.newValue) {
    consumeRevisitPendingAction().catch(() => {});
  }
});

// ---------- generate ----------
el("generateBtn").addEventListener("click", async () => {
  const v = getFormValues();
  if (!v.draft && !v.promptExtra) {
    setStatus(el("formStatus"), "Paste a draft or add prompt context first.", "error");
    return;
  }
  const providers = await getAvailableProviders();
  if (!providers.length) {
    setStatus(el("formStatus"), "Add at least one API key in Settings.", "error");
    el("settingsSection").classList.add("open");
    return;
  }
  el("generateBtn").disabled = true;
  el("output").innerHTML = '<div class="loading">Thinking…</div>';
  setStatus(el("formStatus"), "");
  try {
    const { conversationId, ticketUrl } = await getCurrentTicket();
    const result = await compose({ ...v, conversationId, ticketUrl, rewriteOf: state.rewriteOf });
    if (result.error) {
      el("output").innerHTML = "";
      setStatus(el("formStatus"), result.error, "error");
      return;
    }
    state.lastDraftId = result.draftId;
    state.lastParsed = result.parsed;
    state.lastLibraryEntryId = result.libraryEntryId;
    state.rewriteOf = null;
    renderOutput(result.parsed, result.provider);
    await renderLibraryPicker();
  } finally {
    el("generateBtn").disabled = false;
  }
});

el("clearBtn").addEventListener("click", () => {
  el("draft").value = "";
  el("promptExtra").value = "";
  el("output").innerHTML = "";
  const slot = el("stepOneSlot");
  if (slot) { slot.innerHTML = ""; slot.style.display = "none"; }
  el("libraryPick").value = "";
  el("libraryPickMeta").textContent = "";
  setStatus(el("formStatus"), "");
});

// ---------- render output ----------
function plainToHtml(text) {
  if (!text) return "";
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const blocks = escaped.split(/\n{2,}/);
  return blocks.map((block) => {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return "";
    const isBullets = lines.every((l) => /^[-*•]\s+/.test(l));
    const isNumbered = lines.every((l) => /^\d+\.\s+/.test(l));
    if (isBullets) return `<ul>${lines.map((l) => `<li>${l.replace(/^[-*•]\s+/, "")}</li>`).join("")}</ul>`;
    if (isNumbered) return `<ol>${lines.map((l) => `<li>${l.replace(/^\d+\.\s+/, "")}</li>`).join("")}</ol>`;
    return `<p>${lines.join("<br>")}</p>`;
  }).join("");
}

function renderOutput(parsed, provider) {
  const section = (title, cls, text) => text ? `
    <div class="output-section">
      <h4>${title}</h4>
      <div class="output-box ${cls}">${plainToHtml(text)}</div>
      <div class="output-actions">
        <button data-copy="${cls}">Copy</button>
        ${cls !== "reason" ? `<button data-insert="${cls}" class="primary">Insert into ticket</button>` : ""}
      </div>
    </div>` : "";

  el("output").innerHTML = `
    ${section("Reason", "reason", parsed.reason)}
    ${section("Version A — The Polish", "version-a", parsed.versionA)}
    ${section("Version B — The Revamp", "version-b", parsed.versionB)}
    <div class="meta">Draft ${state.lastDraftId?.slice(0, 8)} · ${provider}${state.lastLibraryEntryId ? " · library" : ""}</div>
  `;
  el("output").querySelectorAll("button[data-copy]").forEach((b) => b.addEventListener("click", () => copyVersion(b.dataset.copy)));
  el("output").querySelectorAll("button[data-insert]").forEach((b) => b.addEventListener("click", () => insertVersion(b.dataset.insert)));
  refreshStepOneSlot().catch(() => {});
}

function versionHtml(key) { return el("output").querySelector(`.output-box.${key}`)?.innerHTML || ""; }
function versionText(key) { return el("output").querySelector(`.output-box.${key}`)?.innerText || ""; }

function versionLabel(key) {
  return key === "version-b" ? "Version B (Revamp)" : "Version A (Polish)";
}

function copyInsertStoredMessage(action, key) {
  const v = versionLabel(key);
  if (action === "insert") {
    return `Inserted ${v} into the ticket editor. Ticket + delivery saved for revisit (last copy or insert wins if you switch versions).`;
  }
  return `Copied ${v} to clipboard. Ticket + delivery saved for revisit (last copy wins if you switch versions).`;
}

async function copyVersion(key) {
  const html = versionHtml(key), text = versionText(key);
  let clipOk = false;
  try {
    await navigator.clipboard.write([new ClipboardItem({
      "text/html": new Blob([html], { type: "text/html" }),
      "text/plain": new Blob([text], { type: "text/plain" })
    })]);
    clipOk = true;
  } catch {
    try {
      await navigator.clipboard.writeText(text);
      clipOk = true;
    } catch {
      clipOk = false;
    }
  }
  if (state.lastDraftId) {
    await updateDraft(state.lastDraftId, {
      delivery_action: "copy",
      delivered_at: new Date().toISOString(),
      chosen_version: key
    });
  }
  if (clipOk) {
    setStatus(el("formStatus"), copyInsertStoredMessage("copy", key), "ok");
  } else {
    setStatus(el("formStatus"), "Could not copy to clipboard. Delivery was still saved for this ticket.", "error");
  }
  refreshStepOneSlot().catch(() => {});
}

async function insertVersion(key) {
  const html = versionHtml(key);
  if (!html) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, func: insertHtmlInActiveEditor, args: [html]
    });
    if (result?.result?.ok) {
      if (state.lastDraftId) {
        await updateDraft(state.lastDraftId, {
          delivery_action: "insert",
          delivered_at: new Date().toISOString(),
          chosen_version: key
        });
      }
      setStatus(el("formStatus"), copyInsertStoredMessage("insert", key), "ok");
      refreshStepOneSlot().catch(() => {});
    } else {
      setStatus(el("formStatus"), "No editor focused. Copied instead.", "error");
      await copyVersion(key);
    }
  } catch (e) {
    setStatus(el("formStatus"), `Insert failed: ${e.message}. Copied instead.`, "error");
    await copyVersion(key);
  }
}

function insertHtmlInActiveEditor(html) {
  const sel = window.getSelection();
  let editor = document.activeElement?.closest?.(".note-editable") || document.querySelector(".note-editable");
  const doInsert = (target) => {
    if (target) target.focus();
    if (!sel || !sel.rangeCount || (target && !target.contains(sel.anchorNode))) {
      const r = document.createRange();
      if (target) { r.selectNodeContents(target); r.collapse(false); }
      sel.removeAllRanges(); sel.addRange(r);
    }
    const r = sel.getRangeAt(0);
    r.deleteContents();
    const temp = document.createElement("div");
    temp.innerHTML = html;
    const frag = document.createDocumentFragment();
    while (temp.firstChild) frag.appendChild(temp.firstChild);
    r.insertNode(frag);
    if (target) ["input", "keydown", "keyup", "change"].forEach((t) => target.dispatchEvent(new Event(t, { bubbles: true })));
    return { ok: true };
  };
  if (editor) return doInsert(editor);
  if (sel?.rangeCount) return doInsert(null);
  return { ok: false };
}

// ---------- library panel ----------
el("libraryToggle").addEventListener("click", async () => {
  const panel = el("historyPanel");
  panel.classList.toggle("open");
  if (panel.classList.contains("open")) await renderLibraryPanel();
});

el("exportHistory").addEventListener("click", async () => {
  const [drafts, library] = await Promise.all([getAllDrafts(), getAllEntries()]);
  const payload = { exported_at: new Date().toISOString(), drafts, library };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `om-assistant-${new Date().toISOString().slice(0, 10)}.json`;
  a.click(); URL.revokeObjectURL(url);
});

el("clearHistory").addEventListener("click", async () => {
  if (!confirm("Clear draft log? (Library and seeds kept.)")) return;
  await chrome.storage.local.set({ draft_log: [] });
  await renderLibraryPanel();
});

async function renderLibraryPanel() {
  const m = await computeMetrics(30);
  const rateCls = m.readyRate == null ? "" : m.readyRate >= 70 ? "good" : "warn";
  const mgrCls = m.managerRate == null ? "" : m.managerRate >= 50 ? "good" : "warn";
  el("metricsGrid").innerHTML = `
    <div class="metric"><div class="num ${rateCls}">${m.readyRate == null ? "—" : m.readyRate + "%"}</div><div class="lbl">Ready-to-send</div></div>
    <div class="metric"><div class="num ${mgrCls}">${m.managerRate == null ? "—" : m.managerRate + "%"}</div><div class="lbl">Manager approved</div></div>
    <div class="metric"><div class="num">${m.libraryCount}</div><div class="lbl">Library prompts</div></div>
    <div class="metric"><div class="num">${m.totalDrafts}</div><div class="lbl">Drafts (30d)</div></div>
    <div class="metric"><div class="num">${m.quickTransforms}</div><div class="lbl">Quick transforms</div></div>
    <div class="metric"><div class="num ${m.pendingSuggestionCount ? "warn" : ""}">${m.pendingSuggestionCount}</div><div class="lbl">Suggestions</div></div>
  `;
  await Promise.all([renderLibraryList(), renderSuggestionList(), renderRecentDrafts()]);
}

async function renderLibraryList() {
  const entries = (await getAllEntries()).sort((a, b) => b.weighted_score - a.weighted_score);
  const list = el("libraryList");
  if (!entries.length) {
    list.innerHTML = '<div class="empty">Library empty. Generate a reply to populate.</div>';
    return;
  }
  list.innerHTML = entries.map(renderLibraryItem).join("");
  list.querySelectorAll("[data-reuse]").forEach((b) => b.addEventListener("click", () => reuseLibrary(b.dataset.reuse, "rerun")));
  list.querySelectorAll("[data-load]").forEach((b) => b.addEventListener("click", () => reuseLibrary(b.dataset.load, "loadform")));
}

function renderLibraryItem(e) {
  const d = e.dropdowns;
  const chips = [d.goal, d.audience, d.tone, d.mode].filter(Boolean).map((c) => `<span class="chip">${escapeHtml(c)}</span>`).join("");
  const srcBadge = `<span class="badge ${e.source}">${e.source}</span>`;
  const score = e.weighted_score ? `<span class="li-score">${Math.round(e.weighted_score)}</span>` : "";
  return `
    <div class="library-item">
      <div class="li-head">
        <span class="li-title">${escapeHtml(e.scenario_title)}</span>
        <span>${srcBadge} ${score}</span>
      </div>
      <div class="li-summary">${escapeHtml(e.scenario_summary)}</div>
      <div class="li-chips">${chips}</div>
      <div class="li-actions">
        <button class="primary" data-reuse="${e.id}">Reuse on current draft</button>
        <button data-load="${e.id}">Load into form</button>
      </div>
    </div>
  `;
}

async function reuseLibrary(entryId, mode) {
  const entry = await getEntry(entryId);
  if (!entry) return;
  el("product").value = entry.product;
  setDropdowns(entry.dropdowns);
  el("libraryPick").value = entryId;
  el("libraryPickMeta").textContent = entry.scenario_summary;
  if (mode === "loadform") {
    el("historyPanel").classList.remove("open");
    el("draft").focus();
    return;
  }
  el("historyPanel").classList.remove("open");
  el("generateBtn").click();
}

async function renderSuggestionList() {
  const pending = await getAllPendingSuggestions();
  const list = el("suggestionList");
  if (!pending.length) {
    list.innerHTML = '<div class="empty">No suggestions pending.</div>';
    return;
  }
  list.innerHTML = pending.map(({ entry, suggestion }) => {
    const a = suggestion.ai_analysis || {};
    const changes = (a.proposed_changes || []).map((c) =>
      `<div class="s-change">• <strong>${escapeHtml(c.type)}</strong> → ${escapeHtml(c.value || "")} <em style="color:#78716c">(${escapeHtml(c.reason || "")})</em></div>`
    ).join("");
    return `
      <div class="suggestion" data-entry="${entry.id}" data-sug="${suggestion.id}">
        <div class="s-head">${escapeHtml(entry.scenario_title)} — ${escapeHtml(a.summary || "no summary")}</div>
        ${changes || '<div class="s-change" style="color:#78716c">No structural changes proposed.</div>'}
        <div class="s-actions">
          <button class="primary" data-res="accepted">Accept</button>
          <button data-res="rejected">Reject</button>
          <button data-res="deferred">Defer</button>
        </div>
      </div>
    `;
  }).join("");

  list.querySelectorAll(".suggestion").forEach((node) => {
    node.querySelectorAll("button[data-res]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await resolveSuggestion(node.dataset.entry, node.dataset.sug, btn.dataset.res);
        renderLibraryPanel();
      });
    });
  });
}

async function renderRecentDrafts() {
  const drafts = (await getAllDrafts()).slice().reverse().slice(0, 25);
  const list = el("historyList");
  if (!drafts.length) { list.innerHTML = '<div class="empty">No drafts yet.</div>'; return; }
  list.innerHTML = drafts.map((d) => {
    const when = new Date(d.ts).toLocaleString();
    const isQuick = d.action_type === "quick-retone" || d.action_type === "quick-translate";
    const badge = isQuick
      ? `<span class="badge quick">${d.action_type === "quick-translate" ? "translate" : "retone"}</span>`
      : d.outcome
      ? `<span class="badge ${d.outcome === "manager_approved" || d.outcome === "managerial_rewrite" ? "sent" : d.outcome}">${(d.outcome || "").replace(/_/g, " ")}</span>`
      : `<span class="badge none">no outcome</span>`;
    const title = isQuick
      ? (d.action_type === "quick-translate" ? "Translate → " + d.action_id : "Retone: " + d.action_id)
      : `${d.product || "?"} · ${d.mode || "?"} · ${d.tone || "?"}`;
    const convo = d.conversation_id ? `#${d.conversation_id}` : "no ticket";
    const snippet = escapeHtml((isQuick ? stripTags(d.output_html || "") : d.output_parsed?.versionA || d.draft_input || "").slice(0, 200));
    return `<div class="history-item"><div class="hi-head"><strong>${escapeHtml(title)}</strong>${badge}</div><div class="hi-meta">${when} · ${convo} · ${d.provider || "?"}</div><div class="hi-snippet">${snippet}</div></div>`;
  }).join("");
}

function stripTags(html) { return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); }
function escapeHtml(s) { return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

async function getCurrentTicket() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return { conversationId: null, ticketUrl: null };
    const m = tab.url.match(/^https:\/\/om\.wpsiteassist\.com\/conversation\/(\d+)/);
    return { conversationId: m ? m[1] : null, ticketUrl: tab.url };
  } catch { return { conversationId: null, ticketUrl: null }; }
}

async function focusAssistantPanel() {
  try {
    const w = await chrome.windows.getCurrent();
    if (w?.id != null && chrome.sidePanel?.open) {
      await chrome.sidePanel.open({ windowId: w.id });
    }
  } catch {
    /* ignore */
  }
}

/** One of three mutually exclusive Step 1 modes (saved as verbatim + boundary). */
function deriveStep1Mode(d) {
  if (d.final_used_verbatim === false) return "edited";
  if (d.final_used_verbatim === true && d.final_used_boundary === "manager") return "manager_first";
  if (d.final_used_verbatim === true) return "as_copied";
  return "";
}

/** scope must be unique per mount (e.g. "revisit" vs "slot") so radio groups never collide in the DOM. */
function buildStepOneBlockHtml(draft, scope) {
  const vid = draft.id;
  const ns = `${vid}-${scope}`;
  const mode = deriveStep1Mode(draft);
  const asCopied = mode === "as_copied" ? "checked" : "";
  const edited = mode === "edited" ? "checked" : "";
  const mgrFirst = mode === "manager_first" ? "checked" : "";
  const showText = mode === "edited" ? " s1-show-text" : "";
  return `
    <div class="step-one${showText}" data-step1-root="${vid}" data-step1-scope="${scope}">
      <div class="s1-head">Step 1 — What went forward?</div>
      <p class="s1-help">Pick one. If you edited before sending, paste your real wording below.</p>
      <div class="s1-row">
        <label><input type="radio" name="s1mode-${ns}" value="as_copied" ${asCopied}/> Used assistant reply as copied</label>
        <label><input type="radio" name="s1mode-${ns}" value="edited" ${edited}/> I edited / different text</label>
        <label><input type="radio" name="s1mode-${ns}" value="manager_first" ${mgrFirst}/> Manager saw this first</label>
      </div>
      <textarea class="s1-text" rows="5" placeholder="Paste the wording you actually put forward (links, edits)…"></textarea>
      <div class="s1-row">
        <button type="button" class="primary s1-save">Save Step 1</button>
        ${draft.final_used_at ? `<span class="meta s1-saved">Saved ${escapeHtml(new Date(draft.final_used_at).toLocaleString())}</span>` : ""}
      </div>
    </div>`;
}

function bindStepOneRoot(root, draft, stage, scope, previewOpts = null) {
  if (!root) return;
  const id = draft.id;
  const ns = `${id}-${scope}`;
  const previewEl = previewOpts?.el || null;
  const baseFallback = previewOpts?.baseAssistantText ?? chosenAssistantReply(draft);

  const syncStep2Preview = () => {
    if (!previewEl) return;
    const mEl = root.querySelector(`input[name="s1mode-${ns}"]:checked`);
    const raw =
      mEl?.value === "edited"
        ? (root.querySelector(".s1-text")?.value || "")
        : baseFallback;
    const t = String(raw);
    previewEl.textContent = t.length > 400 ? `${t.slice(0, 400)}…` : t;
  };

  const syncVis = () => {
    const edited = root.querySelector(`input[name="s1mode-${ns}"][value="edited"]`)?.checked;
    root.classList.toggle("s1-show-text", !!edited);
    syncStep2Preview();
  };
  root.querySelectorAll(`input[name="s1mode-${ns}"]`).forEach((inp) => inp.addEventListener("change", syncVis));
  syncVis();
  const ta = root.querySelector(".s1-text");
  if (ta) {
    ta.value = draft.final_used_text || "";
    ta.addEventListener("input", syncStep2Preview);
  }
  syncStep2Preview();

  root.querySelector(".s1-save")?.addEventListener("click", async () => {
    const modeEl = root.querySelector(`input[name="s1mode-${ns}"]:checked`);
    if (!modeEl) {
      setStatus(el("formStatus"), "Pick one Step 1 option.", "error");
      return;
    }
    const mode = modeEl.value;
    const text = (ta?.value || "").trim();
    if (mode === "edited" && !text) {
      setStatus(el("formStatus"), "Paste what you actually put forward, or pick another option.", "error");
      return;
    }
    const verbatim = mode !== "edited";
    const boundary = mode === "manager_first" ? "manager" : "customer";
    await updateDraft(draft.id, {
      final_used_verbatim: verbatim,
      final_used_text: mode === "edited" ? text : null,
      final_used_boundary: boundary,
      final_used_at: new Date().toISOString(),
      final_used_stage: stage
    });
    setStatus(el("formStatus"), "Step 1 saved. You can update it anytime before Step 2.", "ok");
    await renderRevisitCard();
    await refreshStepOneSlot();
    if (el("historyPanel").classList.contains("open")) renderLibraryPanel();
  });
}

async function refreshStepOneSlot() {
  const slot = el("stepOneSlot");
  if (!slot) return;
  const sid = state.lastDraftId;
  if (!sid) {
    slot.style.display = "none";
    slot.innerHTML = "";
    return;
  }
  const drafts = await getAllDrafts();
  const d = drafts.find((x) => x.id === sid);
  if (!d || !draftIsRevisitPending(d)) {
    slot.style.display = "none";
    slot.innerHTML = "";
    return;
  }
  const { conversationId } = await getCurrentTicket();
  const unresolved = conversationId ? await getUnresolvedDeliveredByConversation(conversationId) : [];
  const latest = unresolved.length ? unresolved[unresolved.length - 1] : null;
  const card = el("revisitCard");
  const revisitShowsStep1 =
    card?.style?.display !== "none" &&
    conversationId &&
    latest &&
    latest.id === d.id &&
    state.revisitHiddenConversationId !== conversationId;
  if (revisitShowsStep1) {
    slot.style.display = "none";
    slot.innerHTML = "";
    return;
  }
  slot.style.display = "block";
  slot.innerHTML = buildStepOneBlockHtml(d, "slot");
  bindStepOneRoot(slot.querySelector("[data-step1-root]"), d, "post_copy", "slot", null);
}

async function saveManagerialRewrite(draft) {
  const wrap = el("revisitCard")?.querySelector(".r-mgrrw");
  const text = (wrap?.querySelector(".mgr-rw-text")?.value || "").trim();
  if (!text) {
    setStatus(el("formStatus"), "Paste the managerial rewrite first.", "error");
    return;
  }
  await updateDraft(draft.id, { outcome: "managerial_rewrite", manager_rewrite_text: text });
  if (draft.library_entry_id) await bumpScore(draft.library_entry_id, "manager_approved", 5);
  setStatus(el("formStatus"), "Logged managerial rewrite (+5, same weight as manager approved).", "ok");
  state.revisitMgrRewriteDraftId = null;
  await focusAssistantPanel();
  el("formStatus")?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  await renderRevisitCard();
  await refreshStepOneSlot();
  if (el("historyPanel").classList.contains("open")) renderLibraryPanel();
}

async function consumeRevisitPendingAction() {
  const { revisit_pending_action: p } = await chrome.storage.local.get("revisit_pending_action");
  if (!p) return;
  if (typeof p.ts !== "number" || Date.now() - p.ts > 120_000) {
    await chrome.storage.local.remove("revisit_pending_action");
    return;
  }
  await chrome.storage.local.remove("revisit_pending_action");

  if (p.action === "open_panel") {
    const { conversationId } = await getCurrentTicket();
    if (conversationId && String(conversationId) === String(p.conversationId)) {
      state.revisitHiddenConversationId = null;
      await focusAssistantPanel();
      await renderRevisitCard();
      el("revisitCard")?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
      setStatus(el("formStatus"), "Use the blue card: Step 1, then Sent / Manager approved / Managerial rewrite.", "ok");
    }
    return;
  }

  const drafts = await getAllDrafts();
  const draft = drafts.find((d) => d.id === p.draftId);
  if (!draft || String(draft.conversation_id) !== String(p.conversationId)) return;
  state.revisitHiddenConversationId = null;
  await handleRevisit(p.action, draft, p.conversationId);
}

// ---------- revisit card ----------
async function renderRevisitCard() {
  const card = el("revisitCard");
  const { conversationId } = await getCurrentTicket();
  if (!conversationId) {
    card.style.display = "none";
    card.innerHTML = "";
    state.revisitHiddenConversationId = null;
    state.revisitMgrRewriteDraftId = null;
    await refreshStepOneSlot();
    return;
  }

  if (state.revisitHiddenConversationId && state.revisitHiddenConversationId !== conversationId) {
    state.revisitHiddenConversationId = null;
  }

  const unresolved = await getUnresolvedDeliveredByConversation(conversationId);
  if (!unresolved.length) {
    card.style.display = "none";
    card.innerHTML = "";
    state.revisitMgrRewriteDraftId = null;
    await refreshStepOneSlot();
    return;
  }

  if (state.revisitMgrRewriteDraftId &&
      !unresolved.some((d) => d.id === state.revisitMgrRewriteDraftId)) {
    state.revisitMgrRewriteDraftId = null;
  }

  if (state.revisitHiddenConversationId === conversationId) {
    card.style.display = "none";
    card.innerHTML = "";
    await refreshStepOneSlot();
    return;
  }

  const latest = unresolved[unresolved.length - 1];
  const assistantBase = chosenAssistantReply(latest);
  const when = new Date(latest.delivered_at || latest.ts).toLocaleString();
  const showMgrRw = state.revisitMgrRewriteDraftId === latest.id;
  const step1Html = buildStepOneBlockHtml(latest, "revisit");

  const slot = el("stepOneSlot");
  if (slot) {
    slot.innerHTML = "";
    slot.style.display = "none";
  }

  card.innerHTML = `
    <div class="revisit">
      ${step1Html}
      <div class="r-head">Ticket #${conversationId} — prior draft from assistant</div>
      <div class="r-sub">${unresolved.length} unresolved · last ${latest.delivery_action || "delivered"} ${when}</div>
      <div class="r-sub" style="margin-top:4px;color:#64748b">Step 2 preview (updates as you edit Step 1)</div>
      <div class="r-draft" data-r-draft-preview="1"></div>
      <div class="r-actions">
        <button type="button" class="primary" data-revisit="sent">Sent as-is (+2)</button>
        <button type="button" class="primary" data-revisit="manager_approved">Manager approved (+5)</button>
        <button type="button" data-revisit="managerial_rewrite">${showMgrRw ? "Cancel managerial rewrite" : "Managerial rewrite (+5)"}</button>
        <button type="button" class="ghost" data-revisit="dismiss">Dismiss</button>
      </div>
      ${showMgrRw ? `
      <div class="r-mgrrw">
        <label for="mgrRwText">Paste manager’s rewrite (final wording)</label>
        <textarea id="mgrRwText" class="mgr-rw-text" placeholder="Paste the version after managerial rewrite…"></textarea>
        <div class="r-mgrrw-actions">
          <button type="button" class="primary mgr-rw-save">Save managerial rewrite</button>
          <button type="button" class="mgr-rw-cancel">Cancel</button>
        </div>
      </div>` : ""}
    </div>
  `;
  card.style.display = "";

  const previewDraftEl = card.querySelector("[data-r-draft-preview]");
  const s1root = card.querySelector("[data-step1-root]");
  bindStepOneRoot(s1root, latest, "post_revisit", "revisit", {
    el: previewDraftEl,
    baseAssistantText: assistantBase
  });

  card.querySelectorAll("button[data-revisit]").forEach((btn) => {
    btn.addEventListener("click", () => handleRevisit(btn.dataset.revisit, latest, conversationId));
  });
  card.querySelector(".mgr-rw-save")?.addEventListener("click", () => saveManagerialRewrite(latest));
  card.querySelector(".mgr-rw-cancel")?.addEventListener("click", async () => {
    state.revisitMgrRewriteDraftId = null;
    await renderRevisitCard();
  });
  await refreshStepOneSlot();
}

async function handleRevisit(action, draft, conversationId) {
  if (action === "dismiss") {
    state.revisitHiddenConversationId = conversationId;
    state.revisitMgrRewriteDraftId = null;
    await renderRevisitCard();
    return;
  }
  if (action === "sent" || action === "manager_approved") {
    await updateDraft(draft.id, { outcome: action });
    if (draft.library_entry_id) {
      const field = action === "sent" ? "sent_as_is" : "manager_approved";
      const amount = action === "sent" ? 2 : 5;
      await bumpScore(draft.library_entry_id, field, amount);
    }
    setStatus(el("formStatus"), `Logged: ${action.replace(/_/g, " ")}.`, "ok");
    await focusAssistantPanel();
    el("formStatus")?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    await renderRevisitCard();
    if (el("historyPanel").classList.contains("open")) renderLibraryPanel();
    return;
  }
  if (action === "managerial_rewrite") {
    state.revisitMgrRewriteDraftId =
      state.revisitMgrRewriteDraftId === draft.id ? null : draft.id;
    await renderRevisitCard();
    return;
  }
}

// ---------- init ----------
(async function init() {
  await loadSettings();
  await renderDropdowns();
  await renderLibraryPicker();
  await consumeIncomingSelection();
  await renderRevisitCard();
  await consumeRevisitPendingAction();
  await refreshStepOneSlot();
  chrome.tabs.onActivated?.addListener?.(() => {
    renderRevisitCard().catch(() => {});
    refreshStepOneSlot().catch(() => {});
  });
  chrome.tabs.onUpdated?.addListener?.((_, info) => {
    if (info.url) {
      renderRevisitCard().catch(() => {});
      refreshStepOneSlot().catch(() => {});
    }
  });
})();
