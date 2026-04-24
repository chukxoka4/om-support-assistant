// Service worker: context menus, quick transforms, revisit notifications.
// Sidepanel communicates via chrome.storage, not tabs.sendMessage.

import { logQuickTransform } from "./lib/storage.js";
import { retone, translate, RETONE_ACTIONS, LANGUAGES } from "./lib/quick-transform.js";
import { seedIfEmpty } from "./lib/library.js";

function conversationIdFromUrl(url) {
  const m = (url || "").match(/^https:\/\/om\.wpsiteassist\.com\/conversation\/(\d+)/);
  return m ? m[1] : null;
}

chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.removeAll(() => buildMenus());
  try { await seedIfEmpty(); } catch (e) { console.warn("Library seed failed:", e); }
});

function buildMenus() {
  chrome.contextMenus.create({
    id: "om-send-to-draft",
    title: "Send to OM Assistant → Draft (append at cursor)",
    contexts: ["selection"]
  });
  chrome.contextMenus.create({
    id: "om-send-to-prompt",
    title: "Send to OM Assistant → Prompt (append at cursor)",
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
  if (id === "om-send-to-draft") return handleSendToAssistant(info, tab, "draft");
  if (id === "om-send-to-prompt") return handleSendToAssistant(info, tab, "prompt");
  if (typeof id === "string" && id.startsWith("om-improve-")) {
    return handleQuickTransform(tab, "retone", id.replace("om-improve-", ""));
  }
  if (typeof id === "string" && id.startsWith("om-translate-")) {
    const langId = id.replace("om-translate-", "");
    const lang = LANGUAGES.find((l) => l.id === langId);
    if (lang) return handleQuickTransform(tab, "translate", lang.name);
  }
});

async function handleSendToAssistant(info, tab, target = "draft") {
  if (!info.selectionText) return;
  await chrome.storage.local.set({
    incoming_selection: {
      text: info.selectionText,
      target,
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

// Revisit detection is handled inside the sidepanel when it reads the active
// tab URL. Background no longer fires OS notifications for revisits — they
// were easy to miss and didn't show the prior draft inline.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "ticketOpened" && msg.conversationId) {
    chrome.storage.local.set({ last_ticket_opened: { id: msg.conversationId, ts: Date.now() } });
  }
});
