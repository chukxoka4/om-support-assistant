import {
  getApiKeys,
  setApiKeys,
  getDefaultProvider,
  setDefaultProvider,
  getAvailableProviders,
  getAllDrafts
} from "./lib/storage.js";
import {
  getAllEntries,
  replaceAllEntries,
  clearAll,
  seedIfEmpty
} from "./lib/library.js";

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

function setLibraryStatus(text, kind = "ok") {
  const node = el("library-status");
  node.textContent = text;
  node.style.color = kind === "err" ? "#b00020" : "#0a7c2f";
}

function validateImportEntry(entry, idx) {
  if (!entry || typeof entry !== "object")
    throw new Error(`Entry ${idx}: not an object`);
  if (typeof entry.id !== "string" || !entry.id)
    throw new Error(`Entry ${idx}: missing id`);
  if (typeof entry.product !== "string" || !entry.product)
    throw new Error(`Entry ${idx}: missing product`);
  if (!entry.dropdowns || typeof entry.dropdowns !== "object")
    throw new Error(`Entry ${idx}: missing dropdowns`);
  if (typeof entry.scenario_instruction !== "string" || !entry.scenario_instruction)
    throw new Error(`Entry ${idx}: missing scenario_instruction`);
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
  try {
    const [library, drafts] = await Promise.all([getAllEntries(), getAllDrafts()]);
    const payload = {
      exported_at: new Date().toISOString(),
      version: 3,
      library,
      drafts
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `om-assistant-library-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setLibraryStatus(`Exported ${library.length} entries.`);
  } catch (err) {
    setLibraryStatus(`Export failed: ${err.message}`, "err");
  }
});

el("import").addEventListener("click", () => el("import-file").click());

el("import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = "";
  try {
    const parsed = JSON.parse(await file.text());
    if (parsed.version !== 3)
      throw new Error(`Unsupported version: ${parsed.version}`);
    if (!Array.isArray(parsed.library))
      throw new Error("Missing library array");
    parsed.library.forEach(validateImportEntry);
    await replaceAllEntries(parsed.library);
    setLibraryStatus(`Imported ${parsed.library.length} entries.`);
  } catch (err) {
    setLibraryStatus(`Import failed: ${err.message}`, "err");
  }
});

el("reset-library").addEventListener("click", async () => {
  try {
    await clearAll();
    const result = await seedIfEmpty();
    setLibraryStatus(`Reset to seeds (${result.count || 0} entries).`);
  } catch (err) {
    setLibraryStatus(`Reset failed: ${err.message}`, "err");
  }
});

init();
