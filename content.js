// Entry point: runs in every tab. Handles:
//   (a) selection capture + in-place HTML replace (Summernote-aware)
//   (b) revisit check for tickets on om.wpsiteassist.com
//
// No ES imports here — MV3 content scripts don't support modules.
// Keep this file under 300 lines; delegate anything heavier to sidepanel or background.

(function () {
  const TICKET_URL_PATTERN = /^https:\/\/om\.wpsiteassist\.com\/conversation\/(\d+)/;

  function parseConversationId(url) {
    const m = url.match(TICKET_URL_PATTERN);
    return m ? m[1] : null;
  }

  function getSelectionHtml() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return "";
    const range = sel.getRangeAt(0);
    const div = document.createElement("div");
    div.appendChild(range.cloneContents());
    return div.innerHTML;
  }

  function insertHtmlAtSelection(html) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return false;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const temp = document.createElement("div");
    temp.innerHTML = html;
    const frag = document.createDocumentFragment();
    while (temp.firstChild) frag.appendChild(temp.firstChild);
    range.insertNode(frag);

    const editor = document.querySelector(".note-editable");
    if (editor) {
      ["input", "keydown", "keyup", "change"].forEach((type) => {
        editor.dispatchEvent(new Event(type, { bubbles: true }));
      });
    }
    return true;
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "getSelectionHtml") {
      sendResponse({ html: getSelectionHtml() });
      return;
    }
    if (msg.type === "insertHtml") {
      const ok = insertHtmlAtSelection(msg.html);
      sendResponse({ ok });
      return;
    }
    if (msg.type === "getConversationId") {
      sendResponse({ conversationId: parseConversationId(location.href) });
      return;
    }
  });

  // Revisit check: notify background so it can fire a chrome.notification.
  const convId = parseConversationId(location.href);
  if (convId) {
    chrome.runtime.sendMessage({ type: "ticketOpened", conversationId: convId, url: location.href });
  }
})();
