import { describe, it, expect } from "vitest";
import { normalize, isMeaningfulDiff } from "../../lib/diff-text.js";

describe("normalize", () => {
  it("strips HTML tags and collapses whitespace", () => {
    expect(normalize("<p>Hello   world</p>")).toBe("hello world");
  });
  it("decodes common entities", () => {
    expect(normalize("Tom &amp; Jerry &nbsp; said &quot;hi&quot;")).toBe('tom & jerry said "hi"');
  });
  it("is case-insensitive", () => {
    expect(normalize("Hello")).toBe(normalize("HELLO"));
  });
  it("safe on null/undefined", () => {
    expect(normalize(null)).toBe("");
    expect(normalize(undefined)).toBe("");
  });
});

describe("isMeaningfulDiff", () => {
  it("returns false when only HTML/whitespace differs", () => {
    expect(isMeaningfulDiff("<p>Hi there</p>", "Hi there")).toBe(false);
    expect(isMeaningfulDiff("Hi  there", "Hi there  ")).toBe(false);
  });
  it("returns true on real word changes", () => {
    expect(isMeaningfulDiff("Hi there", "Hi friend")).toBe(true);
  });
  it("treats case-only changes as non-meaningful", () => {
    expect(isMeaningfulDiff("Hello", "hello")).toBe(false);
  });
});
