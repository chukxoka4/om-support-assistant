import { getLibrary } from "./lib/prompts.js";
import { compose } from "./lib/compose.js";
import { getAvailableProviders, getDefaultProvider } from "./lib/storage.js";
import { updateDraft } from "./lib/storage.js";

const el = (id) => document.getElementById(id);
const state = { selectionHtml: "", conversationId: null, lastDraftId: null };

async function init() {
  const lib = await getLibrary();
  const actionSelect = el("action-select");
  lib.actions.forEach((a) => {
    const opt = document.createElement("option");
    opt.value = a.id;
    opt.textContent = a.label;
    actionSelect.appendChild(opt);
  });

  const providers = await getAvailableProviders();
  if (providers.length > 1) {
    el("provider-row").style.display = "";
    const pSelect = el("provider-select");
    const def = await getDefaultProvider();
    providers.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p;
      opt.textContent = p;
      if (p === def) opt.selected = true;
      pSelect.appendChild(opt);
    });
  }

  await pullSelectionFromActiveTab();
}

async function pullSelectionFromActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    const resp = await chrome.tabs.sendMessage(tab.id, { type: "getSelectionHtml" });
    if (resp?.html) setSelection(resp.html);
    const convResp = await chrome.tabs.sendMessage(tab.id, { type: "getConversationId" });
    state.conversationId = convResp?.conversationId || null;
    if (state.conversationId) el("selection-meta").textContent = `Ticket #${state.conversationId}`;
  } catch {
    // content script not present on this tab
  }
}

function setSelection(html) {
  state.selectionHtml = html;
  el("selection-preview").innerHTML = html || "<em style='color:#999'>No selection</em>";
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "sidepanelReceiveSelection") setSelection(msg.html || "");
});

el("generate").addEventListener("click", async () => {
  el("error").textContent = "";
  el("draft-preview").innerHTML = "<em>Generating…</em>";
  const actionId = el("action-select").value;
  const provider = el("provider-select")?.value || null;
  const notes = el("notes").value;
  const result = await compose({
    actionId,
    selectionHtml: state.selectionHtml,
    notes,
    conversationId: state.conversationId,
    provider
  });
  if (result.error) {
    el("error").textContent = result.error;
    el("draft-preview").innerHTML = "";
    return;
  }
  el("draft-preview").innerHTML = result.html;
  state.lastDraftId = result.draftId;
  el("draft-meta").textContent = `Draft ${result.draftId.slice(0, 8)} · ${result.provider}`;
});

el("clear").addEventListener("click", () => {
  el("draft-preview").innerHTML = "";
  el("notes").value = "";
  el("error").textContent = "";
  el("draft-meta").textContent = "";
});

el("insert").addEventListener("click", async () => {
  const html = el("draft-preview").innerHTML;
  if (!html) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const resp = await chrome.tabs.sendMessage(tab.id, { type: "insertHtml", html });
  if (resp?.ok && state.lastDraftId) {
    const outcome = prompt("Outcome? (sent / edited / rewrote)", "sent");
    if (outcome) await updateDraft(state.lastDraftId, { outcome });
  }
});

el("copy").addEventListener("click", async () => {
  const html = el("draft-preview").innerHTML;
  if (!html) return;
  const blob = new Blob([html], { type: "text/html" });
  const text = el("draft-preview").innerText;
  await navigator.clipboard.write([
    new ClipboardItem({
      "text/html": blob,
      "text/plain": new Blob([text], { type: "text/plain" })
    })
  ]);
});

init();
