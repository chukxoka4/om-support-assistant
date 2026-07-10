// Layer-4 provider: routes an LLM call through the local Claude Code bridge
// (a native-messaging host) instead of an HTTP API. Same contract as its
// siblings — strings in, { text } / { text: "", error } out — but its transport
// is chrome.runtime.sendNativeMessage and it carries NO apiKey: the bridge runs
// `claude -p` on the agent's Enterprise seat (see bridge/README.md).

const HOST = "com.optinmonster.claude_bridge";

// Promisify sendNativeMessage's callback form and fold chrome.runtime.lastError
// (bridge not installed, host manifest missing, host crashed) into a value.
function sendNative(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendNativeMessage(HOST, message, (response) => {
        const err = chrome.runtime.lastError;
        if (err) return resolve({ error: err.message || String(err) });
        resolve({ response });
      });
    } catch (e) {
      resolve({ error: e.message });
    }
  });
}

// mode: "transform" (default, no tools) | "reason" (read-only KB search).
// Only this provider honours `mode`; the HTTP providers ignore it (agnosticism).
export async function callClaudeCode({ model, system, user, mode }) {
  const { response, error } = await sendNative({ system, user, model, mode });
  if (error) return { text: "", error: `claude-code bridge unavailable: ${error}` };
  if (!response) return { text: "", error: "claude-code bridge: no response" };
  if (response.error) return { text: "", error: response.error };
  return { text: response.text || "" };
}

// Health check for the options "Test connection" flow. Returns availability plus
// whether the bridge sees a knowledge-base folder (reason-mode capability).
export async function pingClaudeCode() {
  const { response, error } = await sendNative({ ping: true });
  if (error) return { ok: false, error };
  if (!response || !response.pong) return { ok: false, error: "no pong from bridge" };
  return { ok: true, kb: !!response.kb };
}
