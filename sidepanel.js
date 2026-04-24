import { compose } from "./lib/compose.js";
import {
  getApiKeys, setApiKeys,
  getDefaultProvider, setDefaultProvider, getAvailableProviders,
  getTaxonomy, addTaxonomyValue,
  getAllDrafts, updateDraft
} from "./lib/storage.js";
import { computeMetrics } from "./lib/metrics.js";
import {
  getAllEntries, getAllPendingSuggestions, bumpScore, resolveSuggestion, getEntry
} from "./lib/library.js";
import { proposeSuggestion } from "./lib/suggestions.js";

const el = (id) => document.getElementById(id);
const state = { lastDraftId: null, lastParsed: null, lastLibraryEntryId: null };

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

// ---------- incoming selection ----------
async function consumeIncomingSelection() {
  const { incoming_selection } = await chrome.storage.local.get("incoming_selection");
  if (!incoming_selection) return;
  if (Date.now() - incoming_selection.ts > 60_000) {
    await chrome.storage.local.remove("incoming_selection");
    return;
  }
  el("draft").value = incoming_selection.text;
  await chrome.storage.local.remove("incoming_selection");
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.incoming_selection?.newValue) {
    el("draft").value = changes.incoming_selection.newValue.text;
    chrome.storage.local.remove("incoming_selection");
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
    const conversationId = await getCurrentConversationId();
    const result = await compose({ ...v, conversationId });
    if (result.error) {
      el("output").innerHTML = "";
      setStatus(el("formStatus"), result.error, "error");
      return;
    }
    state.lastDraftId = result.draftId;
    state.lastParsed = result.parsed;
    state.lastLibraryEntryId = result.libraryEntryId;
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
}

function versionHtml(key) { return el("output").querySelector(`.output-box.${key}`)?.innerHTML || ""; }
function versionText(key) { return el("output").querySelector(`.output-box.${key}`)?.innerText || ""; }

async function copyVersion(key) {
  const html = versionHtml(key), text = versionText(key);
  try {
    await navigator.clipboard.write([new ClipboardItem({
      "text/html": new Blob([html], { type: "text/html" }),
      "text/plain": new Blob([text], { type: "text/plain" })
    })]);
    setStatus(el("formStatus"), "Copied with formatting.", "ok");
  } catch {
    await navigator.clipboard.writeText(text);
    setStatus(el("formStatus"), "Copied as plain text.", "ok");
  }
  showOutcomeChip(key, "copy");
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
      setStatus(el("formStatus"), "Inserted into editor.", "ok");
      showOutcomeChip(key, "insert");
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

// ---------- outcome chip ----------
function showOutcomeChip(versionKey, action) {
  if (!state.lastDraftId) return;
  const section = el("output").querySelector(`.output-box.${versionKey}`)?.parentElement;
  if (!section) return;
  section.querySelector(".outcome-chip")?.remove();
  section.querySelector(".correction-box")?.remove();

  const chip = document.createElement("div");
  chip.className = "outcome-chip";
  chip.innerHTML = `
    <span class="label">${action === "copy" ? "Copied" : "Inserted"} — outcome?</span>
    <button class="sent" data-outcome="sent">Sent as-is</button>
    <button class="sent" data-outcome="manager_approved" title="Sent AND Erica approved">Manager approved</button>
    <button class="edited" data-outcome="edited">Edited</button>
    <button class="rewrote" data-outcome="rewrote">Rewrote</button>
    <button class="skip" data-outcome="skip">skip</button>
  `;
  section.appendChild(chip);

  const draftId = state.lastDraftId;
  const libId = state.lastLibraryEntryId;
  const userOutput = versionText(versionKey);
  const timer = setTimeout(() => chip.remove(), 20000);

  chip.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", async () => {
      clearTimeout(timer);
      const outcome = btn.dataset.outcome;
      if (outcome === "skip") { chip.remove(); return; }
      await updateDraft(draftId, { outcome, chosen_version: versionKey, delivery_action: action, delivered_at: new Date().toISOString() });
      if (libId) {
        if (outcome === "sent") await bumpScore(libId, "sent_as_is", 1);
        if (outcome === "manager_approved") await bumpScore(libId, "manager_approved", 1);
      }
      if (outcome === "edited" || outcome === "rewrote") {
        chip.remove();
        promptForCorrection(section, draftId, libId, userOutput, outcome);
        return;
      }
      setStatus(el("formStatus"), `Logged: ${outcome.replace("_", " ")}.`, "ok");
      chip.remove();
      if (el("historyPanel").classList.contains("open")) renderLibraryPanel();
    });
  });
}

function promptForCorrection(section, draftId, libId, userOutput, outcome) {
  const box = document.createElement("div");
  box.className = "correction-box";
  box.innerHTML = `
    <label style="font-size:11px;color:var(--muted)">Paste the final version actually sent:</label>
    <textarea placeholder="Paste Erica's / your final sent version here…"></textarea>
    <div class="cb-actions">
      <button class="primary save">Save &amp; analyse</button>
      <button class="cancel">Skip</button>
    </div>
  `;
  section.appendChild(box);

  box.querySelector(".cancel").addEventListener("click", () => box.remove());
  box.querySelector(".save").addEventListener("click", async () => {
    const finalText = box.querySelector("textarea").value.trim();
    if (!finalText) { box.remove(); return; }
    await updateDraft(draftId, { final_sent: finalText, correction_logged: true });
    setStatus(el("formStatus"), "Analysing correction…", "ok");
    box.remove();
    if (libId) {
      const { error } = await proposeSuggestion({
        entryId: libId, draftId, userOutput, finalOutput: finalText, trigger: outcome
      });
      if (!error) await bumpScore(libId, "rewrites_absorbed", 1);
      setStatus(el("formStatus"), error ? `Suggestion error: ${error}` : "Suggestion queued in Library.", error ? "error" : "ok");
    }
    if (el("historyPanel").classList.contains("open")) renderLibraryPanel();
  });
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
      ? `<span class="badge ${d.outcome === "manager_approved" ? "sent" : d.outcome}">${d.outcome.replace("_", " ")}</span>`
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

async function getCurrentConversationId() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return null;
    const m = tab.url.match(/^https:\/\/om\.wpsiteassist\.com\/conversation\/(\d+)/);
    return m ? m[1] : null;
  } catch { return null; }
}

// ---------- init ----------
(async function init() {
  await loadSettings();
  await renderDropdowns();
  await renderLibraryPicker();
  await consumeIncomingSelection();
})();
