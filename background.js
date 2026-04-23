import { compose } from "./lib/compose.js";
import { getDraftsByConversation, getDismissal, setDismissal } from "./lib/storage.js";
import { getLibrary } from "./lib/prompts.js";

const REVISIT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

chrome.runtime.onInstalled.addListener(async () => {
  await rebuildContextMenus();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.library_override) rebuildContextMenus();
});

async function rebuildContextMenus() {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: "om-assistant-root",
    title: "OM Assistant",
    contexts: ["selection", "editable"]
  });
  chrome.contextMenus.create({
    id: "om-assistant-open-sidepanel",
    parentId: "om-assistant-root",
    title: "Send to sidepanel…",
    contexts: ["selection", "editable"]
  });

  const lib = await getLibrary();
  if (!lib?.actions?.length) return;

  const byProduct = lib.actions.reduce((acc, a) => {
    (acc[a.product] = acc[a.product] || []).push(a);
    return acc;
  }, {});

  for (const [product, actions] of Object.entries(byProduct)) {
    const productMenuId = `om-assistant-product-${product}`;
    chrome.contextMenus.create({
      id: productMenuId,
      parentId: "om-assistant-root",
      title: product,
      contexts: ["selection", "editable"]
    });
    for (const a of actions) {
      chrome.contextMenus.create({
        id: `om-assistant-action-${a.id}`,
        parentId: productMenuId,
        title: a.label.replace(/^[^→]*→\s*/, ""),
        contexts: ["selection", "editable"]
      });
    }
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;

  if (info.menuItemId === "om-assistant-open-sidepanel") {
    await chrome.sidePanel.open({ tabId: tab.id });
    const { html } = await chrome.tabs.sendMessage(tab.id, { type: "getSelectionHtml" });
    chrome.runtime.sendMessage({ type: "sidepanelReceiveSelection", html });
    return;
  }

  if (typeof info.menuItemId === "string" && info.menuItemId.startsWith("om-assistant-action-")) {
    const actionId = info.menuItemId.replace("om-assistant-action-", "");
    const { html: selectionHtml } = await chrome.tabs.sendMessage(tab.id, { type: "getSelectionHtml" });
    const { conversationId } = await chrome.tabs.sendMessage(tab.id, { type: "getConversationId" });
    const result = await compose({ actionId, selectionHtml, conversationId });
    if (result.error) {
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "OM Assistant error",
        message: result.error
      });
      return;
    }
    await chrome.tabs.sendMessage(tab.id, { type: "insertHtml", html: result.html });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "ticketOpened") {
    handleTicketRevisit(msg.conversationId).catch(() => {});
    return;
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
    await chrome.tabs.create({ url: chrome.runtime.getURL(`sidepanel.html#log=${conversationId}`) });
  } else {
    await setDismissal(conversationId, Date.now());
  }
  chrome.notifications.clear(notifId);
});

chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ tabId: tab.id });
});
