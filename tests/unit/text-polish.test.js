// Best-effort grammar polish: always returns a string, never throws.
// Failures (timeout, error, empty) fall back to the original input.

import { describe, it, expect, vi, afterEach } from "vitest";
import { polishText, polishBullets, polishTimeoutFor } from "../../lib/text-polish.js";

const ok = (text) => async () => ({ text, provider: "test" });
const errored = (msg) => async () => ({ text: "", error: msg });
const slow = (text, ms) => async () => new Promise((r) => setTimeout(() => r({ text, provider: "test" }), ms));

describe("polishText", () => {
  it("returns the cleaned LLM output on success", async () => {
    const out = await polishText("ths is a typo-laden sentence", { _callLLM: ok("This is a typo-laden sentence.") });
    expect(out).toBe("This is a typo-laden sentence.");
  });

  it("returns the original on LLM error", async () => {
    const out = await polishText("hello there friend", { _callLLM: errored("network down") });
    expect(out).toBe("hello there friend");
  });

  it("returns the original when no LLM result text comes back", async () => {
    const out = await polishText("hello there friend", { _callLLM: ok("") });
    expect(out).toBe("hello there friend");
  });

  it("returns the original when input is empty / very short", async () => {
    const llm = vi.fn(ok("WHAT THE LLM RETURNED"));
    expect(await polishText("", { _callLLM: llm })).toBe("");
    expect(await polishText("hi", { _callLLM: llm })).toBe("hi");
    expect(await polishText("   ", { _callLLM: llm })).toBe("   ");
    expect(llm).not.toHaveBeenCalled();
  });

  it("returns the original on timeout", async () => {
    const out = await polishText("hello there friend", {
      _callLLM: slow("polished version", 200),
      timeoutMs: 30
    });
    expect(out).toBe("hello there friend");
  });

  it("rejects suspiciously long LLM responses", async () => {
    const original = "fix this sentence please";
    const overlong = "a".repeat(original.length * 5);
    const out = await polishText(original, { _callLLM: ok(overlong) });
    expect(out).toBe(original);
  });

  it("trims surrounding whitespace from the LLM response", async () => {
    const out = await polishText("hello there friend", { _callLLM: ok("  Hello there, friend.  \n") });
    expect(out).toBe("Hello there, friend.");
  });

  it("never throws even when the LLM call rejects", async () => {
    const explode = async () => { throw new Error("boom"); };
    await expect(polishText("hello there friend", { _callLLM: explode })).resolves.toBe("hello there friend");
  });
});

describe("polishBullets", () => {
  it("polishes each bullet independently and preserves order", async () => {
    let i = 0;
    const llm = async () => {
      const arr = ["Cleaned A.", "Cleaned B.", "Cleaned C."];
      return { text: arr[i++], provider: "test" };
    };
    const out = await polishBullets(["aaa is wrong here", "bbb is wrong too here", "ccc also wrong here"], { _callLLM: llm });
    expect(out).toEqual(["Cleaned A.", "Cleaned B.", "Cleaned C."]);
  });

  it("falls back per-bullet without breaking the others", async () => {
    let i = 0;
    const llm = async () => {
      const seq = [{ text: "Cleaned A.", provider: "test" }, { text: "", error: "rate limit" }, { text: "Cleaned C.", provider: "test" }];
      return seq[i++];
    };
    const out = await polishBullets(["aaa is wrong", "bbb is wrong", "ccc is wrong"], { _callLLM: llm });
    expect(out).toEqual(["Cleaned A.", "bbb is wrong", "Cleaned C."]);
  });

  it("returns [] for non-array input", async () => {
    expect(await polishBullets(null)).toEqual([]);
    expect(await polishBullets(undefined)).toEqual([]);
  });
});

// --- DEC-D / D37: provider-aware timeout (D32 contract otherwise preserved) ---
describe("polishTimeoutFor", () => {
  it("gives the connector a wider budget than HTTP providers", () => {
    expect(polishTimeoutFor("claude-code")).toBe(30000);
    expect(polishTimeoutFor("claude")).toBe(5000);
    expect(polishTimeoutFor("gemini")).toBe(5000);
    expect(polishTimeoutFor(null)).toBe(5000);
    expect(polishTimeoutFor(undefined)).toBe(5000);
  });
});

describe("polishText — timeout selection", () => {
  afterEach(() => vi.useRealTimers());

  it("does NOT resolve a provider when timeoutMs is passed explicitly", async () => {
    const resolver = vi.fn(async () => "claude-code");
    const out = await polishText("hello there, fix this", {
      _callLLM: ok("Hello there, fix this."),
      timeoutMs: 1000,
      _resolveDefaultProvider: resolver,
    });
    expect(out).toBe("Hello there, fix this.");
    expect(resolver).not.toHaveBeenCalled();
  });

  it("uses the 30s connector budget so a slow claude-code call still wins", async () => {
    vi.useFakeTimers();
    const callLLM = () => new Promise((r) => setTimeout(() => r({ text: "CLEANED TEXT" }), 10000));
    const p = polishText("this sentence needs a fix", {
      _callLLM: callLLM,
      _resolveDefaultProvider: async () => "claude-code",
    });
    await vi.advanceTimersByTimeAsync(10000);
    expect(await p).toBe("CLEANED TEXT");
  });

  it("keeps the 5s budget for HTTP providers, so the same slow call falls back", async () => {
    vi.useFakeTimers();
    const callLLM = () => new Promise((r) => setTimeout(() => r({ text: "CLEANED TEXT" }), 10000));
    const original = "this sentence needs a fix";
    const p = polishText(original, {
      _callLLM: callLLM,
      _resolveDefaultProvider: async () => "claude",
    });
    await vi.advanceTimersByTimeAsync(10000);
    expect(await p).toBe(original); // timed out at 5s → original (D32 silent fallback)
  });
});

describe("polishBullets — resolves the budget once for the batch", () => {
  it("consults the provider resolver a single time", async () => {
    const resolver = vi.fn(async () => "claude-code");
    const out = await polishBullets(["aaa is wrong here", "bbb is wrong here"], {
      _callLLM: ok("cleaned"),
      _resolveDefaultProvider: resolver,
    });
    expect(out).toEqual(["cleaned", "cleaned"]);
    expect(resolver).toHaveBeenCalledTimes(1);
  });
});
