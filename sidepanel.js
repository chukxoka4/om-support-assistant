import { getLibrary } from "./lib/prompts.js";
import { compose } from "./lib/compose.js";
import {
  getApiKeys,
  setApiKeys,
  getDefaultProvider,
  setDefaultProvider,
  getAvailableProviders,
  getLibraryOverride,
  setLibraryOverride,
  updateDraft,
  getAllDrafts
} from "./lib/storage.js";
import { computeMetrics } from "./lib/metrics.js";

const el = (id) => document.getElementById(id);
const state = { lastDraftId: null, lastParsed: null };

// ---------- form helpers ----------
function setFormValues(v) {
  if (v.product) el("product").value = v.product;
  if (v.goal) el("goal").value = v.goal;
  if (v.mode) el("mode").value = v.mode;
  if (v.audience) el("audience").value = v.audience;
  if (v.tone) el("tone").value = v.tone;
  el("concise").checked = !!v.concise;
  if (v.extra_prompt) el("promptExtra").value = v.extra_prompt;
}

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
    provider: el("providerSelect")?.value || null
  };
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
    const opt = document.createElement("option");
    opt.textContent = "— no providers configured —";
    defaultSel.appendChild(opt);
  } else {
    for (const p of available) {
      const opt = document.createElement("option");
      opt.value = p;
      opt.textContent = p;
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
      opt.value = p;
      opt.textContent = p;
      if (p === current) opt.selected = true;
      providerSelect.appendChild(opt);
    }
  } else {
    providerRow.style.display = "none";
  }
}

el("saveSettings").addEventListener("click", async () => {
  const keys = {
    gemini: el("geminiKey").value.trim(),
    claude: el("claudeKey").value.trim(),
    openai: el("openaiKey").value.trim()
  };
  await setApiKeys(keys);
  const chosen = el("defaultProvider").value;
  if (chosen && chosen !== "— no providers configured —") await setDefaultProvider(chosen);
  await refreshProviderSelects();
  setStatus(el("settingsStatus"), "Saved.", "ok");
  setTimeout(() => setStatus(el("settingsStatus"), ""), 2000);
});

// ---------- templates ----------
async function loadTemplates() {
  const lib = await getLibrary();
  const sel = el("templateSelect");
  sel.innerHTML = '<option value="">— start from scratch —</option>';
  if (!lib?.templates) return;
  for (const t of lib.templates) {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.label;
    sel.appendChild(opt);
  }
}

el("templateSelect").addEventListener("change", async (e) => {
  const id = e.target.value;
  if (!id) return;
  const lib = await getLibrary();
  const t = lib.templates.find((x) => x.id === id);
  if (t) setFormValues(t);
});

el("saveTemplateBtn").addEventListener("click", async () => {
  const label = prompt("Template name?");
  if (!label) return;
  const v = getFormValues();
  const lib = (await getLibraryOverride()) || (await getLibrary()) || { version: 2, templates: [] };
  const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const entry = {
    id,
    label,
    product: v.product,
    goal: v.goal,
    mode: v.mode,
    audience: v.audience,
    tone: v.tone,
    concise: v.concise,
    extra_prompt: v.promptExtra
  };
  const existing = lib.templates.findIndex((x) => x.id === id);
  if (existing >= 0) lib.templates[existing] = entry;
  else lib.templates.push(entry);
  await setLibraryOverride(lib);
  await loadTemplates();
  el("templateSelect").value = id;
  setStatus(el("formStatus"), `Saved template "${label}".`, "ok");
});

el("exportLibrary").addEventListener("click", async () => {
  const lib = await getLibrary();
  const blob = new Blob([JSON.stringify(lib, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `om-assistant-templates-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

el("importLibrary").addEventListener("click", () => el("importFile").click());
el("importFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!parsed.version || !Array.isArray(parsed.templates)) throw new Error("Expected { version, templates: [] }");
    await setLibraryOverride(parsed);
    await loadTemplates();
    setStatus(el("settingsStatus"), `Imported ${parsed.templates.length} templates.`, "ok");
  } catch (err) {
    setStatus(el("settingsStatus"), `Import failed: ${err.message}`, "error");
  }
});

// ---------- incoming selection from context menu ----------
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
    const result = await compose({
      product: v.product,
      draft: v.draft,
      promptExtra: v.promptExtra,
      goal: v.goal,
      mode: v.mode,
      audience: v.audience,
      tone: v.tone,
      concise: v.concise,
      provider: v.provider,
      conversationId,
      templateId: el("templateSelect").value || null
    });

    if (result.error) {
      el("output").innerHTML = "";
      setStatus(el("formStatus"), result.error, "error");
      return;
    }

    state.lastDraftId = result.draftId;
    state.lastParsed = result.parsed;
    renderOutput(result.parsed, result.provider);
  } finally {
    el("generateBtn").disabled = false;
  }
});

el("clearBtn").addEventListener("click", () => {
  el("draft").value = "";
  el("promptExtra").value = "";
  el("output").innerHTML = "";
  el("templateSelect").value = "";
  setStatus(el("formStatus"), "");
});

// ---------- render output ----------
function plainToHtml(text) {
  if (!text) return "";
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const blocks = escaped.split(/\n{2,}/);
  return blocks
    .map((block) => {
      const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
      if (!lines.length) return "";
      const isBullets = lines.every((l) => /^[-*•]\s+/.test(l));
      const isNumbered = lines.every((l) => /^\d+\.\s+/.test(l));
      if (isBullets) return `<ul>${lines.map((l) => `<li>${l.replace(/^[-*•]\s+/, "")}</li>`).join("")}</ul>`;
      if (isNumbered) return `<ol>${lines.map((l) => `<li>${l.replace(/^\d+\.\s+/, "")}</li>`).join("")}</ol>`;
      return `<p>${lines.join("<br>")}</p>`;
    })
    .join("");
}

function renderOutput(parsed, provider) {
  const section = (title, cls, text) => {
    if (!text) return "";
    return `
      <div class="output-section">
        <h4>${title}</h4>
        <div class="output-box ${cls}">${plainToHtml(text)}</div>
        <div class="output-actions">
          <button data-copy="${cls}">Copy</button>
          ${cls !== "reason" ? `<button data-insert="${cls}" class="primary">Insert into ticket</button>` : ""}
        </div>
      </div>`;
  };

  el("output").innerHTML = `
    ${section("Reason", "reason", parsed.reason)}
    ${section("Version A — The Polish", "version-a", parsed.versionA)}
    ${section("Version B — The Revamp", "version-b", parsed.versionB)}
    <div class="meta">Draft ${state.lastDraftId?.slice(0, 8)} · ${provider}</div>
  `;

  el("output").querySelectorAll("button[data-copy]").forEach((btn) => {
    btn.addEventListener("click", () => copyVersion(btn.dataset.copy));
  });
  el("output").querySelectorAll("button[data-insert]").forEach((btn) => {
    btn.addEventListener("click", () => insertVersion(btn.dataset.insert));
  });
}

function versionHtml(key) {
  const box = el("output").querySelector(`.output-box.${key}`);
  return box ? box.innerHTML : "";
}
function versionText(key) {
  const box = el("output").querySelector(`.output-box.${key}`);
  return box ? box.innerText : "";
}

async function copyVersion(key) {
  const html = versionHtml(key);
  const text = versionText(key);
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" })
      })
    ]);
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
      target: { tabId: tab.id },
      func: insertHtmlInActiveEditor,
      args: [html]
    });
    if (result?.result?.ok) {
      setStatus(el("formStatus"), "Inserted into editor.", "ok");
      showOutcomeChip(key, "insert");
    } else {
      setStatus(el("formStatus"), "No editor / selection focused. Copied instead.", "error");
      await copyVersion(key);
    }
  } catch (e) {
    setStatus(el("formStatus"), `Insert failed: ${e.message}. Copied instead.`, "error");
    await copyVersion(key);
  }
}

// Runs in the target tab's isolated world.
function insertHtmlInActiveEditor(html) {
  const sel = window.getSelection();
  let editor = document.activeElement && document.activeElement.closest?.(".note-editable");
  if (!editor) editor = document.querySelector(".note-editable");

  const insertIntoEditor = (target) => {
    target.focus();
    const range = document.createRange();
    if (sel && sel.rangeCount && target.contains(sel.anchorNode)) {
      // keep user's range
    } else {
      range.selectNodeContents(target);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    const r = sel.getRangeAt(0);
    r.deleteContents();
    const temp = document.createElement("div");
    temp.innerHTML = html;
    const frag = document.createDocumentFragment();
    while (temp.firstChild) frag.appendChild(temp.firstChild);
    r.insertNode(frag);
    ["input", "keydown", "keyup", "change"].forEach((t) => {
      target.dispatchEvent(new Event(t, { bubbles: true }));
    });
    return { ok: true };
  };

  if (editor) return insertIntoEditor(editor);

  if (sel && sel.rangeCount) {
    const r = sel.getRangeAt(0);
    r.deleteContents();
    const temp = document.createElement("div");
    temp.innerHTML = html;
    const frag = document.createDocumentFragment();
    while (temp.firstChild) frag.appendChild(temp.firstChild);
    r.insertNode(frag);
    return { ok: true };
  }

  return { ok: false };
}

// ---------- outcome chip ----------
function showOutcomeChip(versionKey, action) {
  if (!state.lastDraftId) return;
  const section = el("output").querySelector(`.output-box.${versionKey}`)?.parentElement;
  if (!section) return;
  const existing = section.querySelector(".outcome-chip");
  if (existing) existing.remove();

  const chip = document.createElement("div");
  chip.className = "outcome-chip";
  chip.innerHTML = `
    <span class="label">${action === "copy" ? "Copied" : "Inserted"} — outcome?</span>
    <button class="sent" data-outcome="sent">Sent as-is</button>
    <button class="edited" data-outcome="edited">Edited</button>
    <button class="rewrote" data-outcome="rewrote">Rewrote</button>
    <button class="skip" data-outcome="skip">skip</button>
  `;
  section.appendChild(chip);

  const draftId = state.lastDraftId;
  const timer = setTimeout(() => chip.remove(), 15000);

  chip.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", async () => {
      clearTimeout(timer);
      const outcome = btn.dataset.outcome;
      if (outcome !== "skip") {
        await updateDraft(draftId, {
          outcome,
          chosen_version: versionKey,
          delivery_action: action,
          delivered_at: new Date().toISOString()
        });
        setStatus(el("formStatus"), `Logged: ${outcome}.`, "ok");
        if (el("historyPanel").classList.contains("open")) renderHistory();
      }
      chip.remove();
    });
  });
}

// ---------- history panel ----------
el("historyToggle").addEventListener("click", async () => {
  const panel = el("historyPanel");
  panel.classList.toggle("open");
  if (panel.classList.contains("open")) await renderHistory();
});

el("exportHistory").addEventListener("click", async () => {
  const drafts = await getAllDrafts();
  const blob = new Blob([JSON.stringify(drafts, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `om-assistant-history-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

el("clearHistory").addEventListener("click", async () => {
  if (!confirm("Clear all draft history? This cannot be undone.")) return;
  await chrome.storage.local.set({ draft_log: [] });
  await renderHistory();
});

async function renderHistory() {
  const metrics = await computeMetrics(30);
  const grid = el("metricsGrid");
  const rateCls = metrics.readyRate == null ? "" : metrics.readyRate >= 70 ? "good" : "warn";
  grid.innerHTML = `
    <div class="metric">
      <div class="num ${rateCls}">${metrics.readyRate == null ? "—" : metrics.readyRate + "%"}</div>
      <div class="lbl">Ready-to-send</div>
    </div>
    <div class="metric">
      <div class="num">${metrics.totalDrafts}</div>
      <div class="lbl">Drafts (30d)</div>
    </div>
    <div class="metric">
      <div class="num">${metrics.quickTransforms}</div>
      <div class="lbl">Quick transforms</div>
    </div>
  `;

  const drafts = (await getAllDrafts()).slice().reverse();
  const list = el("historyList");
  if (!drafts.length) {
    list.innerHTML = '<div class="empty">No history yet. Generate a reply or run a quick transform.</div>';
    return;
  }

  list.innerHTML = drafts.slice(0, 50).map(renderHistoryItem).join("");
  el("historyToggleLabel").textContent = `History & learning (${drafts.length})`;
}

function renderHistoryItem(d) {
  const when = new Date(d.ts).toLocaleString();
  const isQuick = d.action_type === "quick-retone" || d.action_type === "quick-translate";
  const badge = isQuick
    ? `<span class="badge quick">${d.action_type === "quick-translate" ? "translate" : "retone"}</span>`
    : d.outcome
    ? `<span class="badge ${d.outcome}">${d.outcome}</span>`
    : `<span class="badge none">no outcome</span>`;
  const title = isQuick
    ? `${d.action_type === "quick-translate" ? "Translate → " + d.action_id : "Retone: " + d.action_id}`
    : `${d.product || "?"} · ${d.mode || "?"} · ${d.tone || "?"}`;
  const convo = d.conversation_id ? `#${d.conversation_id}` : "no ticket";
  const snippet = escapeHtml(
    (isQuick ? stripTags(d.output_html || "") : d.output_parsed?.versionA || d.draft_input || "").slice(0, 220)
  );
  return `
    <div class="history-item">
      <div class="hi-head">
        <strong>${escapeHtml(title)}</strong>
        ${badge}
      </div>
      <div class="hi-meta">${when} · ${convo} · ${d.provider || "?"}</div>
      <div class="hi-snippet">${snippet}</div>
    </div>
  `;
}

function stripTags(html) { return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); }
function escapeHtml(s) { return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

async function getCurrentConversationId() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return null;
    const m = tab.url.match(/^https:\/\/om\.wpsiteassist\.com\/conversation\/(\d+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// ---------- init ----------
(async function init() {
  await loadSettings();
  await loadTemplates();
  await consumeIncomingSelection();
})();
