const TICKET_HOSTS = {
  "om.wpsiteassist.com": /^\/conversation\/(\d+)/
};

export function parseConversationId(url) {
  try {
    const u = new URL(url);
    const pattern = TICKET_HOSTS[u.hostname];
    if (!pattern) return null;
    const match = u.pathname.match(pattern);
    if (!match) return null;
    return { host: u.hostname, conversationId: match[1] };
  } catch {
    return null;
  }
}

// Email regex used to extract the address from a list-item that may render
// the email as decorated text (e.g. "[a@b.co](mailto:a@b.co)").
export const EMAIL_RX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

// Pure helper (DOM-agnostic, takes any Element/Document with querySelectorAll).
// Returns the unique customer emails inside `ul.customer-contacts li.customer-email`.
// Exported for tests; the in-page version below mirrors this logic.
export function extractEmailsFromDom(root) {
  if (!root?.querySelectorAll) return [];
  const lis = root.querySelectorAll("ul.customer-contacts li.customer-email");
  const out = [];
  for (const li of lis) {
    const candidate = li.querySelector?.("a") || li;
    const href = (candidate.getAttribute?.("href") || "").replace(/^mailto:/i, "");
    const m = EMAIL_RX.exec(href) || EMAIL_RX.exec(candidate.textContent || "");
    if (m) out.push(m[0]);
  }
  return [...new Set(out)];
}

// Browser entry point: runs extractEmailsFromDom inside the page via
// chrome.scripting.executeScript. Returns string[] (possibly empty).
export async function getCustomerEmailsFromPage(tabId) {
  if (!globalThis.chrome?.scripting?.executeScript || !tabId) return [];
  try {
    const [{ result } = {}] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      func: () => {
        const RX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
        const lis = document.querySelectorAll("ul.customer-contacts li.customer-email");
        const out = [];
        for (const li of lis) {
          const a = li.querySelector("a") || li;
          const href = (a.getAttribute && a.getAttribute("href")) || "";
          const stripped = href.replace(/^mailto:/i, "");
          const m = RX.exec(stripped) || RX.exec(a.textContent || "");
          if (m) out.push(m[0]);
        }
        return [...new Set(out)];
      }
    });
    return Array.isArray(result) ? result : [];
  } catch (_e) {
    return [];
  }
}
