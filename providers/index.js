import { callGemini } from "./gemini.js";
import { callClaude } from "./claude.js";
import { callOpenAI } from "./openai.js";
import { getApiKeys, getDefaultProvider, getAvailableProviders } from "../lib/storage.js";

const DISPATCHERS = {
  gemini: callGemini,
  claude: callClaude,
  openai: callOpenAI
};

export async function callLLM({ provider, model, system, user }) {
  const keys = await getApiKeys();
  let chosen = provider;
  if (!chosen) chosen = (await getDefaultProvider()) || (await getAvailableProviders())[0];
  if (!chosen) return { text: "", error: "No provider configured. Add an API key in options." };

  const apiKey = keys[chosen];
  if (!apiKey) return { text: "", error: `No API key for ${chosen}.` };

  const fn = DISPATCHERS[chosen];
  if (!fn) return { text: "", error: `Unknown provider: ${chosen}` };

  try {
    const result = await fn({ apiKey, model, system, user });
    return { ...result, provider: chosen };
  } catch (e) {
    return { text: "", error: `${chosen} call failed: ${e.message}`, provider: chosen };
  }
}

export { getAvailableProviders };
