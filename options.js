import {
  getApiKeys,
  setApiKeys,
  getDefaultProvider,
  setDefaultProvider,
  getAvailableProviders
} from "./lib/storage.js";

const el = (id) => document.getElementById(id);

async function init() {
  const keys = await getApiKeys();
  el("gemini-key").value = keys.gemini || "";
  el("claude-key").value = keys.claude || "";
  el("openai-key").value = keys.openai || "";
  await refreshDefaultProviderOptions();
}

async function refreshDefaultProviderOptions() {
  const select = el("default-provider");
  select.innerHTML = "";
  const available = await getAvailableProviders();
  const current = await getDefaultProvider();
  if (!available.length) {
    const opt = document.createElement("option");
    opt.textContent = "— no providers configured —";
    select.appendChild(opt);
    return;
  }
  for (const p of available) {
    const opt = document.createElement("option");
    opt.value = p;
    opt.textContent = p;
    if (p === current) opt.selected = true;
    select.appendChild(opt);
  }
}

el("save").addEventListener("click", async () => {
  const keys = {
    gemini: el("gemini-key").value.trim(),
    claude: el("claude-key").value.trim(),
    openai: el("openai-key").value.trim()
  };
  await setApiKeys(keys);
  const chosen = el("default-provider").value;
  if (chosen) await setDefaultProvider(chosen);
  await refreshDefaultProviderOptions();
  el("status").textContent = "Saved.";
  setTimeout(() => (el("status").textContent = ""), 2000);
});

// Library export / import / reset are being rewired against the v3 store
// in bug A2. Until then these buttons are intentionally inert so the page
// loads cleanly without the deleted v2 helpers.
const pendingMsg = "Library actions are being rewired in bug A2.";
el("export").addEventListener("click", () => {
  el("library-status").textContent = pendingMsg;
});
el("import").addEventListener("click", () => {
  el("library-status").textContent = pendingMsg;
});
el("reset-library").addEventListener("click", () => {
  el("library-status").textContent = pendingMsg;
});

init();
