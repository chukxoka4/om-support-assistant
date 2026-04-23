import { getLibraryOverride } from "./storage.js";

let cachedDefaultLibrary = null;
let cachedHouseStyle = null;
let cachedProductDocs = {};

async function fetchText(path) {
  const url = chrome.runtime.getURL(path);
  const res = await fetch(url);
  return res.ok ? res.text() : "";
}

async function fetchJson(path) {
  const url = chrome.runtime.getURL(path);
  const res = await fetch(url);
  return res.ok ? res.json() : null;
}

export async function getLibrary() {
  const override = await getLibraryOverride();
  if (override) return override;
  if (!cachedDefaultLibrary) cachedDefaultLibrary = await fetchJson("prompts/library.json");
  return cachedDefaultLibrary;
}

export async function getHouseStyle() {
  if (cachedHouseStyle === null) cachedHouseStyle = await fetchText("prompts/house-style.md");
  return cachedHouseStyle;
}

export async function getProductDoc(product) {
  if (!product) return "";
  if (cachedProductDocs[product] === undefined) {
    cachedProductDocs[product] = await fetchText(`prompts/products/${product}.md`);
  }
  return cachedProductDocs[product];
}

export async function resolveAction(actionId) {
  const lib = await getLibrary();
  if (!lib) return null;
  return lib.actions.find((a) => a.id === actionId) || null;
}

export async function buildPrompt(action, vars = {}) {
  const houseStyle = await getHouseStyle();
  const productDoc = await getProductDoc(action.product);
  const system = (action.system || "")
    .replace("{{house_style}}", houseStyle)
    .replace(`{{product_doc:${action.product}}}`, productDoc);

  let user = action.user_template || "{{selection_html}}";
  for (const [k, v] of Object.entries(vars)) {
    user = user.replaceAll(`{{${k}}}`, v ?? "");
  }
  user = user.replace(/\{\{[^}]+\}\}/g, "");

  const rulesBlock = action.rules?.length
    ? `\n\nRules:\n${action.rules.map((r) => `- ${r}`).join("\n")}`
    : "";
  const examplesBlock = action.examples?.length
    ? `\n\nExamples:\n${action.examples
        .map((e, i) => `Example ${i + 1}:\nInput:\n${e.in}\nOutput:\n${e.out}`)
        .join("\n\n")}`
    : "";

  return {
    system: system + rulesBlock + examplesBlock,
    user
  };
}
