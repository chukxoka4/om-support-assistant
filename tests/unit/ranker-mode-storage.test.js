// F1 — getRankerMode / setRankerMode

import { describe, it, expect, beforeEach } from "vitest";
import { getRankerMode, setRankerMode } from "../../lib/storage.js";

describe("ranker mode storage", () => {
  beforeEach(async () => {
    await chrome.storage.sync.clear();
  });

  it("defaults to lexical when nothing stored", async () => {
    expect(await getRankerMode()).toBe("lexical");
  });

  it("round-trips lexical and llm", async () => {
    await setRankerMode("llm");
    expect(await getRankerMode()).toBe("llm");
    await setRankerMode("lexical");
    expect(await getRankerMode()).toBe("lexical");
  });

  it("returns the default when storage holds an unknown value", async () => {
    await chrome.storage.sync.set({ ranker_mode: "magic" });
    expect(await getRankerMode()).toBe("lexical");
  });

  it("rejects unknown modes with a labelled error", async () => {
    await expect(setRankerMode("magic")).rejects.toThrow(/unknown ranker mode/);
  });
});
