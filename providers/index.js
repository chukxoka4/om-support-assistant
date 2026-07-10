import { callGemini } from "./gemini.js";
import { callClaude } from "./claude.js";
import { callOpenAI } from "./openai.js";
import { callClaudeCode, pingClaudeCode } from "./claude-code.js";
import { getApiKeys, resolveDefaultProvider, getAvailableProviders } from "../lib/storage.js";

const DISPATCHERS = {
  gemini: callGemini,
  claude: callClaude,
  openai: callOpenAI,
  "claude-code": callClaudeCode
};

// Providers that authenticate without an API key (the Claude Code bridge runs on
// the Enterprise-seat OAuth login). They skip the apiKey lookup/check below.
const KEYLESS_PROVIDERS = new Set(["claude-code"]);

// `mode` ("transform" default | "reason") is passed to every dispatcher but only
// claude-code honours it — HTTP providers ignore it. That is the agnosticism
// contract (DEC-F): switching to Gemini/OpenAI/direct-Claude still works, just
// without the KB reasoning layer. No caller sets `mode` until Slice 6.
export async function callLLM({ provider, model, system, user, mode }) {
  const keys = await getApiKeys();
  let chosen = provider;
  if (!chosen) chosen = await resolveDefaultProvider();
  if (!chosen) return { text: "", error: "No provider configured. Add an API key in options." };

  let apiKey;
  if (!KEYLESS_PROVIDERS.has(chosen)) {
    apiKey = keys[chosen];
    if (!apiKey) return { text: "", error: `No API key for ${chosen}.` };
  }

  const fn = DISPATCHERS[chosen];
  if (!fn) return { text: "", error: `Unknown provider: ${chosen}` };

  try {
    const result = await fn({ apiKey, model, system, user, mode });
    return { ...result, provider: chosen };
  } catch (e) {
    return { text: "", error: `${chosen} call failed: ${e.message}`, provider: chosen };
  }
}

export { getAvailableProviders, pingClaudeCode };
