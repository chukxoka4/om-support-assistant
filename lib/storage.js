const KEYS = {
  apiKeys: "api_keys",
  defaultProvider: "default_provider",
  drafts: "draft_log",
  dismissals: "revisit_dismissals",
  taxonomy: "user_taxonomy",
  rankerMode: "ranker_mode",
  intercom: "intercom_config",
  reportConfig: "report_config",
  claudeCodeStatus: "claude_code_status",
  allowThirdParty: "allow_third_party"
};

// The key-less connector. "Available" when its last bridge ping succeeded
// (DEC-E/D38), not when a key exists.
const CLAUDE_CODE = "claude-code";
// Genuinely third-party destinations — gated behind an explicit opt-in
// (DEC-B/D35). Direct-API Claude stays un-gated (same destination, Anthropic).
const THIRD_PARTY_PROVIDERS = new Set(["gemini", "openai"]);

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

// claude-code status: written only by the options "Test connection" flow.
export async function getClaudeCodeStatus() {
  const { [KEYS.claudeCodeStatus]: s } = await chrome.storage.sync.get(KEYS.claudeCodeStatus);
  return s || { enabled: false, lastPingAt: null, lastPingOk: false };
}

export async function setClaudeCodeStatus(patch) {
  const next = { ...(await getClaudeCodeStatus()), ...patch };
  await chrome.storage.sync.set({ [KEYS.claudeCodeStatus]: next });
  return next;
}

export async function getAllowThirdParty() {
  const { [KEYS.allowThirdParty]: v } = await chrome.storage.sync.get(KEYS.allowThirdParty);
  return v === true;
}

export async function setAllowThirdParty(value) {
  await chrome.storage.sync.set({ [KEYS.allowThirdParty]: !!value });
}

// Availability rules (DEC-A/B/E). Order matters: the connector is listed first
// so it wins as the "first available" fallback in resolveDefaultProvider.
// - claude-code: enabled AND last ping OK (key-less)
// - claude:      keyed (un-gated — same destination as the connector)
// - gemini/openai: keyed AND third-party opt-in is on
export async function getAvailableProviders() {
  const keys = await getApiKeys();
  const status = await getClaudeCodeStatus();
  const allowThirdParty = await getAllowThirdParty();
  const keyed = (p) => !!(keys[p] && keys[p].trim());

  const available = [];
  if (status.enabled && status.lastPingOk) available.push(CLAUDE_CODE);
  if (keyed("claude")) available.push("claude");
  for (const p of ["gemini", "openai"]) {
    if (allowThirdParty && THIRD_PARTY_PROVIDERS.has(p) && keyed(p)) available.push(p);
  }
  return available;
}

// Which provider the dispatcher should use when no explicit provider is passed.
// Honour a stored default IF it's still available (back-compat: never clobber
// it — gated/keyless changes only cause it to drop out of availability, and we
// fall through); else prefer the connector; else the first available.
export async function resolveDefaultProvider() {
  const available = await getAvailableProviders();
  if (!available.length) return null;
  const stored = await getDefaultProvider();
  if (stored && available.includes(stored)) return stored;
  if (available.includes(CLAUDE_CODE)) return CLAUDE_CODE;
  return available[0];
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
  // Stamp outcome transitions so range-based reports can bucket by when the
  // outcome happened, not when the draft was generated. Only stamp on the
  // first transition into a non-null outcome, and only if the caller didn't
  // already supply one.
  const next = { ...drafts[idx], ...patch };
  if (
    Object.prototype.hasOwnProperty.call(patch, "outcome") &&
    patch.outcome &&
    !patch.outcome_at &&
    !drafts[idx].outcome_at
  ) {
    next.outcome_at = new Date().toISOString();
  }
  drafts[idx] = next;
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
