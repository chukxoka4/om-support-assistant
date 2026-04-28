const KEYS = {
  apiKeys: "api_keys",
  defaultProvider: "default_provider",
  drafts: "draft_log",
  dismissals: "revisit_dismissals",
  taxonomy: "user_taxonomy",
  rankerMode: "ranker_mode",
  intercom: "intercom_config",
  reportConfig: "report_config"
};

const RANKER_MODES = new Set(["lexical", "llm"]);
const DEFAULT_RANKER_MODE = "lexical";

const TERMINAL_OUTCOMES = new Set(["sent", "manager_approved", "managerial_rewrite"]);

export function isTerminalRevisitOutcome(outcome) {
  return outcome != null && TERMINAL_OUTCOMES.has(outcome);
}

/** Single draft row still needs revisit (delivered, not step-2 resolved). */
export function draftIsRevisitPending(d) {
  if (!d || !d.delivery_action) return false;
  if (isTerminalRevisitOutcome(d.outcome)) return false;
  return true;
}

const DEFAULT_TAXONOMY = {
  goals: [
    "Stop Churn", "Explain Technical Issue", "Upselling", "Account Issue",
    "Just Saying Thanks", "Reactivate Churned User", "Request A Review / Feedback",
    "Close Sale", "Generic Information"
  ],
  audiences: [
    "Frustrated Customer", "Brand New User", "Pre-Sale Inquiry",
    "VIP Client", "Churned Customer", "Happy Customer"
  ],
  tones: [
    "Casual / Conversational", "Strictly Professional",
    "Apologetic", "Direct", "Calm"
  ],
  modes: ["technical", "billing", "lifecycle", "operational", "tone-only"]
};

export async function getTaxonomy() {
  const { [KEYS.taxonomy]: t } = await chrome.storage.local.get(KEYS.taxonomy);
  return t || DEFAULT_TAXONOMY;
}

export async function addTaxonomyValue(field, value) {
  const t = await getTaxonomy();
  if (!t[field]) t[field] = [];
  if (!t[field].includes(value)) t[field].push(value);
  await chrome.storage.local.set({ [KEYS.taxonomy]: t });
  return t;
}

export async function getApiKeys() {
  const { [KEYS.apiKeys]: keys } = await chrome.storage.sync.get(KEYS.apiKeys);
  return keys || { gemini: "", claude: "", openai: "" };
}

export async function setApiKeys(keys) {
  await chrome.storage.sync.set({ [KEYS.apiKeys]: keys });
}

export async function getReportConfig() {
  const { [KEYS.reportConfig]: cfg } = await chrome.storage.sync.get(KEYS.reportConfig);
  return cfg || { agentName: "" };
}

export async function setReportConfig(cfg) {
  await chrome.storage.sync.set({ [KEYS.reportConfig]: cfg || { agentName: "" } });
}

export async function getIntercomConfig() {
  const { [KEYS.intercom]: cfg } = await chrome.storage.sync.get(KEYS.intercom);
  return cfg || { apiKey: "" };
}

export async function setIntercomConfig(cfg) {
  await chrome.storage.sync.set({ [KEYS.intercom]: cfg || { apiKey: "" } });
}

export async function getRankerMode() {
  const { [KEYS.rankerMode]: m } = await chrome.storage.sync.get(KEYS.rankerMode);
  return RANKER_MODES.has(m) ? m : DEFAULT_RANKER_MODE;
}

export async function setRankerMode(mode) {
  if (!RANKER_MODES.has(mode)) throw new Error(`unknown ranker mode: ${mode}`);
  await chrome.storage.sync.set({ [KEYS.rankerMode]: mode });
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

// Drafts for this ticket that were actually delivered (copied or inserted)
// but not yet resolved to a terminal outcome — these trigger the revisit card.
export async function getUnresolvedDeliveredByConversation(conversationId) {
  const drafts = await getDraftsByConversation(conversationId);
  return drafts.filter((d) => draftIsRevisitPending(d));
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
