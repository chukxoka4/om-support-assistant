// Verifies updateDraft() stamps `outcome_at` whenever a draft transitions
// into a non-null outcome, so range-based reports can bucket events by when
// the outcome happened (not when the draft was generated).

import { describe, it, expect, beforeEach } from "vitest";
import { logDraft, updateDraft, getAllDrafts } from "../../lib/storage.js";

async function getOne(id) {
  const all = await getAllDrafts();
  return all.find((d) => d.id === id);
}

describe("updateDraft outcome_at stamping", () => {
  beforeEach(async () => {
    await chrome.storage.local.clear();
  });

  it("stamps outcome_at when patch sets an outcome for the first time", async () => {
    await logDraft({ id: "d1", ts: "2026-04-01T00:00:00Z", outcome: null });
    const before = Date.now();
    await updateDraft("d1", { outcome: "sent" });
    const after = Date.now();
    const d = await getOne("d1");
    expect(d.outcome).toBe("sent");
    expect(typeof d.outcome_at).toBe("string");
    const ts = new Date(d.outcome_at).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("does not overwrite an explicitly supplied outcome_at", async () => {
    await logDraft({ id: "d2", ts: "2026-04-01T00:00:00Z", outcome: null });
    const explicit = "2026-04-06T12:34:56.000Z";
    await updateDraft("d2", { outcome: "manager_approved", outcome_at: explicit });
    const d = await getOne("d2");
    expect(d.outcome_at).toBe(explicit);
  });

  it("does not re-stamp an existing outcome_at on subsequent patches", async () => {
    await logDraft({ id: "d3", ts: "2026-04-01T00:00:00Z", outcome: null });
    await updateDraft("d3", { outcome: "sent" });
    const first = (await getOne("d3")).outcome_at;
    // small delay to ensure clock would tick
    await new Promise((r) => setTimeout(r, 5));
    await updateDraft("d3", { final_used_text: "tweak" });
    expect((await getOne("d3")).outcome_at).toBe(first);
  });

  it("does not stamp outcome_at on patches that don't touch outcome", async () => {
    await logDraft({ id: "d4", ts: "2026-04-01T00:00:00Z", outcome: null });
    await updateDraft("d4", { final_used_text: "hi" });
    const d = await getOne("d4");
    expect(d.outcome_at).toBeUndefined();
  });

  it("does not stamp when outcome is patched to null", async () => {
    await logDraft({ id: "d5", ts: "2026-04-01T00:00:00Z", outcome: null });
    await updateDraft("d5", { outcome: null });
    const d = await getOne("d5");
    expect(d.outcome_at).toBeUndefined();
  });
});
