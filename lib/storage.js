const KEYS = {
  apiKeys: "api_keys",
  defaultProvider: "default_provider",
  library: "library_override",
  drafts: "draft_log",
  dismissals: "revisit_dismissals"
};

export async function getApiKeys() {
  const { [KEYS.apiKeys]: keys } = await chrome.storage.sync.get(KEYS.apiKeys);
  return keys || { gemini: "", claude: "", openai: "" };
}

export async function setApiKeys(keys) {
  await chrome.storage.sync.set({ [KEYS.apiKeys]: keys });
}

export async function getDefaultProvider() {
  const { [KEYS.defaultProvider]: p } = await chrome.storage.sync.get(KEYS.defaultProvider);
  return p || null;
}

export async function setDefaultProvider(provider) {
  await chrome.storage.sync.set({ [KEYS.defaultProvider]: provider });
}

export async function getAvailableProviders() {
  const keys = await getApiKeys();
  return Object.entries(keys).filter(([, v]) => v && v.trim()).map(([k]) => k);
}

export async function getLibraryOverride() {
  const { [KEYS.library]: lib } = await chrome.storage.local.get(KEYS.library);
  return lib || null;
}

export async function setLibraryOverride(library) {
  await chrome.storage.local.set({ [KEYS.library]: library });
}

export async function logDraft(record) {
  const { [KEYS.drafts]: drafts = [] } = await chrome.storage.local.get(KEYS.drafts);
  drafts.push(record);
  await chrome.storage.local.set({ [KEYS.drafts]: drafts });
}

export async function updateDraft(id, patch) {
  const { [KEYS.drafts]: drafts = [] } = await chrome.storage.local.get(KEYS.drafts);
  const idx = drafts.findIndex((d) => d.id === id);
  if (idx === -1) return false;
  drafts[idx] = { ...drafts[idx], ...patch };
  await chrome.storage.local.set({ [KEYS.drafts]: drafts });
  return true;
}

export async function getDraftsByConversation(conversationId) {
  const { [KEYS.drafts]: drafts = [] } = await chrome.storage.local.get(KEYS.drafts);
  return drafts.filter((d) => d.conversation_id === conversationId);
}

export async function logQuickTransform(record) {
  const { [KEYS.drafts]: drafts = [] } = await chrome.storage.local.get(KEYS.drafts);
  drafts.push(record);
  await chrome.storage.local.set({ [KEYS.drafts]: drafts });
}

export async function getAllDrafts() {
  const { [KEYS.drafts]: drafts = [] } = await chrome.storage.local.get(KEYS.drafts);
  return drafts;
}

export async function getDismissal(conversationId) {
  const { [KEYS.dismissals]: d = {} } = await chrome.storage.local.get(KEYS.dismissals);
  return d[conversationId] || null;
}

export async function setDismissal(conversationId, timestamp) {
  const { [KEYS.dismissals]: d = {} } = await chrome.storage.local.get(KEYS.dismissals);
  d[conversationId] = timestamp;
  await chrome.storage.local.set({ [KEYS.dismissals]: d });
}
