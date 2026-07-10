// Best-effort grammar / spelling polish for short user-authored text
// (the weekly "ask", hypothesis bullets). Always returns a string —
// callers never need to handle errors.
//
// Behaviour:
//   - Empty / very short input → return original, skip the LLM call.
//   - LLM call wins (within timeout) → return cleaned text.
//   - LLM call fails / times out / no provider configured → return original.
//
// Tight system prompt: fix mechanics only, no paraphrasing. The whole
// point is "I shouldn't have to intervene unless the LLM is unavailable."

import { callLLM } from "../providers/index.js";
import { resolveDefaultProvider } from "./storage.js";

const SYSTEM = `You are a careful copy editor.
Your job is to fix spelling, punctuation, and grammar in the user's text.

Rules:
- Preserve tone, voice, length, and meaning.
- Do NOT paraphrase or rewrite phrasing that is already correct.
- Do NOT add or remove ideas.
- Do NOT add commentary or labels.
- Output ONLY the cleaned text, nothing else.
- If the input is already clean, return it verbatim.`;

const MIN_LENGTH = 10;
// Provider-aware budget (DEC-D/D37). HTTP providers are fast; a cold `claude -p`
// spawn routinely exceeds 5 s, so give the connector a wider budget. D32's
// contract is otherwise unchanged — this only widens the timeout window.
const DEFAULT_TIMEOUT_MS = 5000;
const CLAUDE_CODE_TIMEOUT_MS = 30000;

// Pure mapping — the DEC-D rule, unit-testable in isolation.
export function polishTimeoutFor(provider) {
  return provider === "claude-code" ? CLAUDE_CODE_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
}

async function resolvePolishTimeout(resolveProvider) {
  try {
    return polishTimeoutFor(await resolveProvider());
  } catch {
    return DEFAULT_TIMEOUT_MS;
  }
}

function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    let settled = false;
    const t = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ text: "", error: "timeout" });
    }, ms);
    promise.then(
      (v) => {
        if (settled) return;
        settled = true;
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(t);
        resolve({ text: "", error: String(e?.message || e) });
      }
    );
  });
}

export async function polishText(
  input,
  { timeoutMs, _callLLM = callLLM, _resolveDefaultProvider = resolveDefaultProvider } = {}
) {
  const original = String(input ?? "");
  if (original.trim().length < MIN_LENGTH) return original;

  // Only resolve the budget when we're actually going to call the LLM.
  const budget = timeoutMs ?? (await resolvePolishTimeout(_resolveDefaultProvider));

  const result = await withTimeout(
    _callLLM({ system: SYSTEM, user: original }),
    budget
  );

  if (!result || result.error) return original;
  const cleaned = String(result.text || "").trim();
  if (!cleaned) return original;

  // Sanity guard against the LLM going off-script and returning something
  // wildly longer than the original (e.g. "Sure! Here's the cleaned…").
  // Cap at ~2.5x the original length; otherwise trust the original.
  if (cleaned.length > original.length * 2.5 + 40) return original;

  return cleaned;
}

// Convenience for arrays of bullets (hypotheses). Each bullet is polished
// independently; failures fall back to that specific original. Preserves
// order and the original count.
export async function polishBullets(bullets, opts = {}) {
  if (!Array.isArray(bullets)) return [];
  // Resolve the provider budget once for the whole batch, not per-bullet.
  const timeoutMs =
    opts.timeoutMs ?? (await resolvePolishTimeout(opts._resolveDefaultProvider || resolveDefaultProvider));
  return Promise.all(bullets.map((b) => polishText(b, { ...opts, timeoutMs })));
}
