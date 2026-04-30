// Pure helper: decide whether a draft_log storage change is meaningful for
// the OM ticket page's revisit-prompt flow.
//
// The content script's storage listener used to fire on every draft_log
// change, including quick-retone / quick-translate writes from the
// right-click overlay. That triggered the native confirm() dialog mid-
// way through the typewriter animation, blocking it.
//
// Quick transforms have their own product surface (the overlay) and don't
// affect the unresolved-delivered revisit flow. Filter them out.
//
// Note: an inline copy of this logic lives at the bottom of content-ticket.js
// because content scripts can't import ESM in MV3. Keep them in sync.

function isQuickTransform(entry) {
  return entry?.action_type === "quick-retone"
      || entry?.action_type === "quick-translate";
}

function indexById(arr) {
  const m = new Map();
  for (const e of arr || []) {
    if (e && e.id) m.set(e.id, e);
  }
  return m;
}

// Returns true if oldArr → newArr added or mutated at least one entry that
// is NOT a quick transform. Quick-transform-only changes return false so
// the listener can early-bail without firing schedulePrompt.
export function shouldPromptForChange(oldArr, newArr) {
  if (!Array.isArray(newArr)) return false;
  const oldMap = indexById(oldArr);

  for (const incoming of newArr) {
    if (!incoming || isQuickTransform(incoming)) continue;
    const existing = oldMap.get(incoming.id);
    if (!existing) {
      // New non-quick entry appeared.
      return true;
    }
    // Existing non-quick entry: detect a meaningful mutation. We compare
    // the JSON serialisation rather than enumerating fields — content-ticket
    // only needs a coarse "did anything change?" signal.
    if (JSON.stringify(existing) !== JSON.stringify(incoming)) {
      return true;
    }
  }
  return false;
}
