import {
  getApiKeys,
  setApiKeys,
  getDefaultProvider,
  setDefaultProvider,
  getAvailableProviders,
  getClaudeCodeStatus,
  setClaudeCodeStatus,
  getAllowThirdParty,
  setAllowThirdParty,
  getAllDrafts,
  getIntercomConfig,
  setIntercomConfig,
  getReportConfig,
  setReportConfig
} from "./lib/storage.js";
import { pingClaudeCode } from "./providers/index.js";
import {
  getAllEntries,
  replaceAllEntries,
  clearAll,
  seedIfEmpty
} from "./lib/library.js";
import { diffImport, mergeNewOnly } from "./lib/library-import.js";
import { showToast } from "./lib/toast.js";
import { makeIntercomClient } from "./lib/intercom-client.js";

const el = (id) => document.getElementById(id);

// Human labels for provider ids (entry-point concern — the dispatcher speaks ids).
const PROVIDER_LABELS = {
  "claude-code": "Claude (Enterprise)",
  claude: "Claude (API key)",
  gemini: "Gemini",
  openai: "OpenAI"
};

let pendingImport = null; // { entries, diff }

async function init() {
  const keys = await getApiKeys();
  el("gemini-key").value = keys.gemini || "";
  el("claude-key").value = keys.claude || "";
  el("openai-key").value = keys.openai || "";
  const intercom = await getIntercomConfig();
  el("intercom-key").value = intercom.apiKey || "";
  const report = await getReportConfig();
  if (el("report-author-name")) el("report-author-name").value = report.agentName || "";
  await applyThirdPartyVisibility(await getAllowThirdParty());
  renderClaudeCodeStatus(await getClaudeCodeStatus());
  await refreshDefaultProviderOptions();
}

// --- Claude Code connector -------------------------------------------------
function renderClaudeCodeStatus(status) {
  const dot = el("cc-dot");
  const text = el("cc-status-text");
  const hint = el("cc-install-hint");
  dot.className = "dot";
  if (!status || !status.lastPingAt) {
    text.textContent = "Not tested yet.";
    if (hint) hint.hidden = true;
    return;
  }
  if (status.lastPingOk) {
    dot.classList.add("dot--ok");
    text.textContent = status.kb ? "Connected · knowledge base detected." : "Connected.";
    if (hint) hint.hidden = true;
  } else {
    dot.classList.add("dot--err");
    text.textContent = status.lastError ? `Not reachable: ${status.lastError}` : "Not reachable.";
    if (hint) hint.hidden = false;
  }
}

el("test-claude-code")?.addEventListener("click", async () => {
  const btn = el("test-claude-code");
  btn.disabled = true;
  el("cc-status-text").textContent = "Testing…";
  const res = await pingClaudeCode();
  const status = await setClaudeCodeStatus({
    enabled: true,
    lastPingOk: !!res.ok,
    lastPingAt: Date.now(),
    kb: !!res.kb,
    lastError: res.ok ? "" : res.error || "no response"
  });
  renderClaudeCodeStatus(status);
  await refreshDefaultProviderOptions();
  showToast("toasts", res.ok ? "Claude Code connected." : `Claude Code: ${res.error || "not reachable"}`, res.ok ? "ok" : "err");
  btn.disabled = false;
});

// --- Third-party provider gate ---------------------------------------------
async function applyThirdPartyVisibility(on) {
  el("allow-third-party").checked = on;
  el("third-party-fields").hidden = !on;
  el("third-party-warning").hidden = !on;
}

el("allow-third-party")?.addEventListener("change", async (e) => {
  const on = e.target.checked;
  await setAllowThirdParty(on);
  await applyThirdPartyVisibility(on);
  await refreshDefaultProviderOptions();
});

el("save-report")?.addEventListener("click", async () => {
  const agentName = el("report-author-name").value.trim();
  await setReportConfig({ agentName });
  const node = el("report-status");
  node.textContent = agentName ? `Saved: ${agentName}` : "Cleared.";
  node.style.color = "#0a7c2f";
  showToast("toasts", agentName ? `Report author saved: ${agentName}` : "Report author cleared.", "ok");
});

function setIntercomStatus(text, kind = "ok") {
  const node = el("intercom-status");
  node.textContent = text;
  node.style.color = kind === "err" ? "#b00020" : "#0a7c2f";
}

el("save-intercom").addEventListener("click", async () => {
  const apiKey = el("intercom-key").value.trim();
  await setIntercomConfig({ apiKey });
  showToast("toasts", apiKey ? "Intercom key saved." : "Intercom key cleared.", "ok");
});

el("test-intercom").addEventListener("click", async () => {
  const apiKey = el("intercom-key").value.trim();
  if (!apiKey) {
    setIntercomStatus("Enter a key first.", "err");
    return;
  }
  setIntercomStatus("Testing…", "ok");
  try {
    const client = makeIntercomClient({ apiKey });
    // Hit /me — the lightest authenticated endpoint. Returns admin/workspace.
    const me = await client.call("/me");
    const appName = me?.app?.name || me?.name || "OK";
    setIntercomStatus(`✓ Connected · ${appName}`, "ok");
    showToast("toasts", `Intercom: connected (${appName}).`, "ok");
  } catch (e) {
    setIntercomStatus(`✗ ${e.message}`, "err");
    showToast("toasts", `Intercom test failed: ${e.message}`, "err");
  }
});

async function refreshDefaultProviderOptions() {
  const select = el("default-provider");
  select.innerHTML = "";
  const available = await getAvailableProviders();
  const current = await getDefaultProvider();
  if (!available.length) {
    const opt = document.createElement("option");
    opt.textContent = "— no providers configured —";
    select.appendChild(opt);
    return;
  }
  for (const p of available) {
    const opt = document.createElement("option");
    opt.value = p;
    opt.textContent = PROVIDER_LABELS[p] || p;
    if (p === current) opt.selected = true;
    select.appendChild(opt);
  }
}

function setLibraryStatus(text, kind = "ok") {
  showToast("toasts", text, kind);
}

function validateImportEntry(entry, idx) {
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

function renderImportConfirm(diff) {
  el("import-summary").innerHTML = `
    File contains <b>${diff.incomingTotal}</b> entries.
    You currently have <b>${diff.currentTotal}</b>.<br>
    <b>${diff.toAdd.length}</b> new ·
    <b>${diff.sameAsLocal.length}</b> already present (identical) ·
    <b>${diff.conflicts.length}</b> already present but different.
  `;
  el("import-merge-hint").textContent =
    `Merge new only: adds ${diff.toAdd.length} new entries. ` +
    `Existing entries (and their scores) stay untouched.`;
  el("import-replace-hint").textContent =
    `Replace all: drops your current ${diff.currentTotal} entries and uses the ` +
    `${diff.incomingTotal} from the file. Scores reset.`;
  el("import-confirm").hidden = false;
}

function closeImportConfirm() {
  el("import-confirm").hidden = true;
  pendingImport = null;
}

el("save").addEventListener("click", async () => {
  const keys = {
    gemini: el("gemini-key").value.trim(),
    claude: el("claude-key").value.trim(),
    openai: el("openai-key").value.trim()
  };
  await setApiKeys(keys);
  const chosen = el("default-provider").value;
  if (chosen) await setDefaultProvider(chosen);
  await refreshDefaultProviderOptions();
  el("status").textContent = "Saved.";
  setTimeout(() => (el("status").textContent = ""), 2000);
});

el("export").addEventListener("click", async () => {
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
    setLibraryStatus(`Exported ${library.length} entries.`);
  } catch (err) {
    setLibraryStatus(`Export failed: ${err.message}`, "err");
  }
});

el("import").addEventListener("click", () => el("import-file").click());

el("import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = "";
  try {
    const parsed = JSON.parse(await file.text());
    if (parsed.version !== 3)
      throw new Error(`Unsupported version: ${parsed.version}`);
    if (!Array.isArray(parsed.library))
      throw new Error("Missing library array");
    parsed.library.forEach(validateImportEntry);

    const current = await getAllEntries();
    const diff = diffImport(current, parsed.library);
    pendingImport = { entries: parsed.library, diff };
    renderImportConfirm(diff);
    setLibraryStatus(`Loaded ${parsed.library.length} entries — confirm below.`);
  } catch (err) {
    closeImportConfirm();
    setLibraryStatus(`Import failed: ${err.message}`, "err");
  }
});

el("import-merge").addEventListener("click", async () => {
  if (!pendingImport) return;
  try {
    const current = await getAllEntries();
    const merged = mergeNewOnly(
      current.map(({ weighted_score, ...rest }) => rest),
      pendingImport.entries
    );
    await replaceAllEntries(merged);
    setLibraryStatus(
      `Merged: added ${pendingImport.diff.toAdd.length} new entries. ` +
        `${pendingImport.diff.sameAsLocal.length + pendingImport.diff.conflicts.length} kept.`
    );
  } catch (err) {
    setLibraryStatus(`Merge failed: ${err.message}`, "err");
  } finally {
    closeImportConfirm();
  }
});

el("import-replace").addEventListener("click", async () => {
  if (!pendingImport) return;
  try {
    await replaceAllEntries(pendingImport.entries);
    setLibraryStatus(
      `Replaced: now ${pendingImport.entries.length} entries. Scores reset.`
    );
  } catch (err) {
    setLibraryStatus(`Replace failed: ${err.message}`, "err");
  } finally {
    closeImportConfirm();
  }
});

el("import-cancel").addEventListener("click", () => {
  closeImportConfirm();
  setLibraryStatus("Import cancelled.");
});

el("reset-library").addEventListener("click", async () => {
  try {
    await clearAll();
    const result = await seedIfEmpty();
    setLibraryStatus(`Reset to seeds (${result.count || 0} entries).`);
  } catch (err) {
    setLibraryStatus(`Reset failed: ${err.message}`, "err");
  }
});

init();
