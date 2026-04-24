// Service worker: context menus, quick transforms, revisit notifications.
// Sidepanel communicates via chrome.storage, not tabs.sendMessage.

import { getDraftsByConversation, getDismissal, setDismissal, logQuickTransform } from "./lib/storage.js";
import { retone, translate, RETONE_ACTIONS, LANGUAGES } from "./lib/quick-transform.js";
import { seedIfEmpty } from "./lib/library.js";

function conversationIdFromUrl(url) {
  const m = (url || "").match(/^https:\/\/om\.wpsiteassist\.com\/conversation\/(\d+)/);
  return m ? m[1] : null;
}

const REVISIT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.removeAll(() => buildMenus());
  try { await seedIfEmpty(); } catch (e) { console.warn("Library seed failed:", e); }
});

function buildMenus() {
  chrome.contextMenus.create({
    id: "om-send-to-assistant",
    title: "Send to OM Assistant (compose)",
    contexts: ["selection"]
  });

  chrome.contextMenus.create({
    id: "om-improve-parent",
    title: "OM Assistant: Improve text",
    contexts: ["selection"]
  });
  for (const [id, { label }] of Object.entries(RETONE_ACTIONS)) {
    chrome.contextMenus.create({
      id: `om-improve-${id}`,
      parentId: "om-improve-parent",
      title: label,
      contexts: ["selection"]
    });
  }

  chrome.contextMenus.create({
    id: "om-translate-parent",
    title: "OM Assistant: Translate to",
    contexts: ["selection"]
  });
  for (const lang of LANGUAGES) {
    chrome.contextMenus.create({
      id: `om-translate-${lang.id}`,
      parentId: "om-translate-parent",
      title: lang.name,
      contexts: ["selection"]
    });
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const id = info.menuItemId;
  if (id === "om-send-to-assistant") return handleSendToAssistant(info, tab);
  if (typeof id === "string" && id.startsWith("om-improve-")) {
    return handleQuickTransform(tab, "retone", id.replace("om-improve-", ""));
  }
  if (typeof id === "string" && id.startsWith("om-translate-")) {
    const langId = id.replace("om-translate-", "");
    const lang = LANGUAGES.find((l) => l.id === langId);
    if (lang) return handleQuickTransform(tab, "translate", lang.name);
  }
});

async function handleSendToAssistant(info, tab) {
  if (!info.selectionText) return;
  await chrome.storage.local.set({
    incoming_selection: {
      text: info.selectionText,
      ts: Date.now(),
      tabId: tab?.id ?? null,
      url: tab?.url ?? null
    }
  });
  try {
    if (tab?.windowId != null) await chrome.sidePanel.open({ windowId: tab.windowId });
    else if (tab?.id != null) await chrome.sidePanel.open({ tabId: tab.id });
  } catch (e) {
    console.warn("sidePanel.open failed:", e.message);
  }
}

async function handleQuickTransform(tab, kind, arg) {
  if (!tab?.id) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [0] },
      files: ["content-overlay.js"]
    });

    const [{ result: selectedHtml } = {}] = await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [0] },
      func: () => (window.__omGetSelectionHtml ? window.__omGetSelectionHtml() : "")
    });

    if (!selectedHtml) {
      await showStatus(tab.id, "No selection found.");
      return;
    }

    await showStatus(tab.id, kind === "retone" ? `Working on: ${RETONE_ACTIONS[arg]?.label || arg}` : `Translating to ${arg}…`);

    const result = kind === "retone" ? await retone(arg, selectedHtml) : await translate(arg, selectedHtml);

    if (result.error) {
      await showStatus(tab.id, `Error: ${result.error}`);
      return;
    }

    await logQuickTransform({
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      action_type: kind === "retone" ? "quick-retone" : "quick-translate",
      action_id: arg,
      conversation_id: conversationIdFromUrl(tab.url),
      provider: result.provider,
      input_html: selectedHtml,
      output_html: result.text,
      outcome: null
    });

    const label = kind === "retone" ? RETONE_ACTIONS[arg]?.label : `Translated to ${arg}`;
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [0] },
      func: (html, lbl) => window.__omShowSuggestion && window.__omShowSuggestion(html, lbl),
      args: [result.text, label]
    });
  } catch (e) {
    console.error("Quick transform failed:", e);
    try { await showStatus(tab.id, `Failed: ${e.message}`); } catch {}
  }
}

async function showStatus(tabId, msg) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      func: (m) => window.__omShowStatus && window.__omShowStatus(m),
      args: [msg]
    });
  } catch {}
}

chrome.action.onClicked.addListener(async (tab) => {
  if (tab?.windowId != null) await chrome.sidePanel.open({ windowId: tab.windowId });
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "ticketOpened" && msg.conversationId) {
    handleTicketRevisit(msg.conversationId).catch(() => {});
  }
});

async function handleTicketRevisit(conversationId) {
  const drafts = await getDraftsByConversation(conversationId);
  const unresolved = drafts.filter((d) => !d.correction_logged);
  if (!unresolved.length) return;

  const dismissed = await getDismissal(conversationId);
  if (dismissed && Date.now() - dismissed < REVISIT_COOLDOWN_MS) return;

  const notifId = `revisit-${conversationId}`;
  chrome.notifications.create(notifId, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: `Ticket #${conversationId} — drafted before`,
    message: `Log the final version for learning? ${unresolved.length} unresolved draft(s).`,
    buttons: [{ title: "Log now" }, { title: "Dismiss" }]
  });
}

chrome.notifications.onButtonClicked.addListener(async (notifId, btnIdx) => {
  if (!notifId.startsWith("revisit-")) return;
  const conversationId = notifId.replace("revisit-", "");
  if (btnIdx === 0) {
    await chrome.storage.local.set({ log_correction_for: conversationId });
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (active?.windowId != null) await chrome.sidePanel.open({ windowId: active.windowId });
  } else {
    await setDismissal(conversationId, Date.now());
  }
  chrome.notifications.clear(notifId);
});
