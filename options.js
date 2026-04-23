import {
  getApiKeys,
  setApiKeys,
  getDefaultProvider,
  setDefaultProvider,
  getAvailableProviders,
  getLibraryOverride,
  setLibraryOverride
} from "./lib/storage.js";
import { getLibrary } from "./lib/prompts.js";

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

el("export").addEventListener("click", async () => {
  const lib = await getLibrary();
  const blob = new Blob([JSON.stringify(lib, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `om-assistant-library-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

el("import").addEventListener("click", () => el("import-file").click());

el("import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (!parsed.version || !Array.isArray(parsed.actions)) {
      throw new Error("Invalid library shape: expected { version, actions: [] }");
    }
    await setLibraryOverride(parsed);
    el("library-status").textContent = `Imported ${parsed.actions.length} action(s).`;
  } catch (err) {
    el("library-status").textContent = `Import failed: ${err.message}`;
  }
});

el("reset-library").addEventListener("click", async () => {
  await setLibraryOverride(null);
  await chrome.storage.local.remove("library_override");
  el("library-status").textContent = "Reset to bundled default.";
});

init();
