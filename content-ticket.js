/**
 * OM conversation pages: SPA-safe ticket detection + native confirm (2 actions).
 * OK = open side panel to finish (Sent / Manager / Rewrite in panel). Cancel = dismiss.
 */
(function () {
  const TICKET_RE = /^https:\/\/om\.wpsiteassist\.com\/conversation\/(\d+)/;

  function convoId() {
    const m = String(location.href || "").match(TICKET_RE);
    return m ? m[1] : null;
  }

  function plainPreview(s, max) {
    return String(s || "")
      .replace(/\r/g, "")
      .slice(0, max);
  }

  let debounceTimer = null;
  /** Last conversation id we saw (clears dismiss when you change tickets). */
  let lastSeenConvoId = null;
  /** In-memory only: Cancel on this ticket in this tab session. Survives SPA same-URL updates, not extension reload. */
  let modalDismissedForId = null;

  function markDismissed(conversationId) {
    modalDismissedForId = conversationId;
  }

  function openPanelToContinue(payload) {
    try {
      chrome.runtime.sendMessage({
        type: "revisitPageAction",
        action: "open_panel",
        conversationId: payload.conversationId,
        draftId: payload.draftId
      });
    } catch {
      /* extension reload */
    }
  }

  function showRevisitConfirm(payload) {
    const { conversationId, draftId, unresolvedCount, snippetPreview, lastAction } = payload;
    const raw = snippetPreview || "";
    const preview = plainPreview(raw, 450);
    const text =
      "OM Support Assistant — unresolved draft on this ticket\n\n" +
      `Ticket #${conversationId} · ${unresolvedCount} open · last: ${lastAction || "delivered"}\n\n` +
      "Preview:\n" +
      (preview ? `${preview}${raw.length > 450 ? "…" : ""}\n\n` : "—\n\n") +
      "Press OK to open the assistant side panel and finish (Step 1, Sent as-is, Manager approved, Managerial rewrite).\n" +
      "Press Cancel to dismiss this reminder for now (same as Dismiss in the panel).";

    const ok = window.confirm(text);
    if (ok) openPanelToContinue({ conversationId, draftId });
    else markDismissed(conversationId);
  }

  function maybePrompt(id) {
    if (modalDismissedForId === id) return;
    chrome.runtime.sendMessage({ type: "ticketOpened", conversationId: id }, (resp) => {
      if (chrome.runtime.lastError) return;
      if (!resp?.showRevisitModal || !resp.modalPayload) return;
      if (modalDismissedForId === id) return;
      showRevisitConfirm(resp.modalPayload);
    });
  }

  /** Same URL can gain an unresolved draft later (side panel). Re-check whenever URL hooks or storage fires. */
  function schedulePrompt() {
    const id = convoId();
    clearTimeout(debounceTimer);
    if (!id) {
      lastSeenConvoId = null;
      return;
    }
    if (id !== lastSeenConvoId) {
      lastSeenConvoId = id;
      modalDismissedForId = null;
    }
    debounceTimer = setTimeout(() => maybePrompt(id), 250);
  }

  function checkTicket() {
    schedulePrompt();
  }

  function hookHistory() {
    const fire = () => setTimeout(checkTicket, 0);
    window.addEventListener("popstate", fire);
    const _ps = history.pushState;
    history.pushState = function () {
      _ps.apply(this, arguments);
      fire();
    };
    const _rs = history.replaceState;
    history.replaceState = function () {
      _rs.apply(this, arguments);
      fire();
    };
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes.draft_log) return;
      const id = convoId();
      if (!id) return;
      modalDismissedForId = null;
      schedulePrompt();
    });
  } catch {
    /* ignore */
  }

  hookHistory();
  checkTicket();
})();
