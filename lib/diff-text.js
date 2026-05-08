// Minimal text-diff helpers for the suggestion proposal pipeline. The goal
// is "is there a non-trivial textual difference?", not a real diff. If the
// two texts normalise to the same string we skip the LLM call entirely —
// nothing to learn from. Anything else flows through and the LLM decides
// whether the change was structural or just a typo.

export function normalize(text) {
  return String(text ?? "")
    .replace(/<[^>]+>/g, " ")     // strip HTML tags
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function isMeaningfulDiff(a, b) {
  return normalize(a) !== normalize(b);
}
