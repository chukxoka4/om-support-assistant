// Service worker: context menu for "Send to OM Assistant", URL revisit notifications.
// Communication with sidepanel is via chrome.storage (not tabs.sendMessage).

import { getDraftsByConversation, getDismissal, setDismissal } from "./lib/storage.js";

const REVISIT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "om-send-to-assistant",
    title: "Send to OM Assistant",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "om-send-to-assistant") return;
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
    if (tab?.windowId != null) {
      await chrome.sidePanel.open({ windowId: tab.windowId });
    } else if (tab?.id != null) {
      await chrome.sidePanel.open({ tabId: tab.id });
    }
  } catch (e) {
    // sidePanel.open must be called from a user gesture; context menu click qualifies.
    console.warn("sidePanel.open failed:", e.message);
  }
});

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
