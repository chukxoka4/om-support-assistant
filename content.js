// Minimal content script.
// Sole responsibility: on ticket pages for om.wpsiteassist.com, tell the
// background about the ticket so it can fire a revisit notification.
//
// Insertion into Summernote is done from the sidepanel via
// chrome.scripting.executeScript, not via messaging to this script.

(function () {
  const TICKET_URL = /^https:\/\/om\.wpsiteassist\.com\/conversation\/(\d+)/;
  const m = location.href.match(TICKET_URL);
  if (!m) return;
  try {
    chrome.runtime.sendMessage({ type: "ticketOpened", conversationId: m[1] });
  } catch {
    // no-op; context invalidated on extension reload
  }
})();
