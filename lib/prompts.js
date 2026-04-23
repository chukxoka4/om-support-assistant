import { getLibraryOverride } from "./storage.js";

const PRODUCT_SLUGS = {
  OptinMonster: "optinmonster",
  TrustPulse: "trustpulse",
  Beacon: "beacon"
};

const PRODUCT_ROLES = {
  OptinMonster: "Expert OptinMonster Success Specialist",
  TrustPulse: "Expert TrustPulse Technical Support",
  Beacon: "Expert Beacon Lead Magnet Specialist"
};

const PRODUCT_DOC_HOSTS = {
  OptinMonster: "optinmonster.com/docs",
  TrustPulse: "trustpulse.com/docs",
  Beacon: "blog.beacon.by/docs"
};

let cachedDefaultLibrary = null;
let cachedHouseStyle = null;
const cachedProductDocs = {};

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
  const slug = PRODUCT_SLUGS[product];
  if (!slug) return "";
  if (cachedProductDocs[slug] === undefined) {
    cachedProductDocs[slug] = await fetchText(`prompts/products/${slug}.md`);
  }
  return cachedProductDocs[slug];
}

export function getProductRole(product) {
  return PRODUCT_ROLES[product] || `Expert ${product} Support Specialist`;
}

export function getProductDocHost(product) {
  return PRODUCT_DOC_HOSTS[product] || "";
}
