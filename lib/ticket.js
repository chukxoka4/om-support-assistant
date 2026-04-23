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
