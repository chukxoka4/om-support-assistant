// Pure helpers for diffing an incoming library payload against the current one.
// Both Options and the side-panel settings call these so the merge/replace
// behaviour stays identical between surfaces.

function sameContent(a, b) {
  if (!a || !b) return false;
  if (a.scenario_instruction !== b.scenario_instruction) return false;
  const ad = a.dropdowns || {};
  const bd = b.dropdowns || {};
  return (
    ad.goal === bd.goal &&
    ad.audience === bd.audience &&
    ad.tone === bd.tone &&
    ad.mode === bd.mode &&
    !!ad.concise === !!bd.concise &&
    a.product === b.product
  );
}

// Returns four buckets so the surface can render an explicit summary
// before the user picks Merge or Replace.
//   toAdd        — incoming entries with ids that don't exist locally
//   sameAsLocal  — incoming entries whose id + content match a local entry
//   conflicts    — incoming entries whose id matches a local one but content differs
//   incomingTotal / currentTotal — for display only
export function diffImport(current, incoming) {
  const byId = new Map(current.map((e) => [e.id, e]));
  const toAdd = [];
  const sameAsLocal = [];
  const conflicts = [];
  for (const inc of incoming) {
    const local = byId.get(inc.id);
    if (!local) toAdd.push(inc);
    else if (sameContent(inc, local)) sameAsLocal.push(inc);
    else conflicts.push({ incoming: inc, local });
  }
  return {
    toAdd,
    sameAsLocal,
    conflicts,
    incomingTotal: incoming.length,
    currentTotal: current.length
  };
}

// Merge: keep every existing entry untouched (preserves scores, last_used_at,
// pending_suggestions). Append incoming entries whose id is new.
export function mergeNewOnly(current, incoming) {
  const ids = new Set(current.map((e) => e.id));
  const additions = incoming.filter((e) => !ids.has(e.id));
  return current.concat(additions);
}
