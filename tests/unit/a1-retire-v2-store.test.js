// Bug A1 — Retire the dead v2 library store.
// Asserts the v2 surface is gone and v3 untouched.

import { describe, it, expect } from "vitest";
import * as storage from "../../lib/storage.js";
import * as prompts from "../../lib/prompts.js";
import manifest from "../../manifest.json" with { type: "json" };

describe("A1: lib/storage.js no longer exports v2 helpers", () => {
  it("getLibraryOverride is gone", () => {
    expect(storage.getLibraryOverride).toBeUndefined();
  });
  it("setLibraryOverride is gone", () => {
    expect(storage.setLibraryOverride).toBeUndefined();
  });
  it("v3 surface and unrelated helpers still exported", () => {
    expect(typeof storage.logDraft).toBe("function");
    expect(typeof storage.getApiKeys).toBe("function");
    expect(typeof storage.getTaxonomy).toBe("function");
  });
});

describe("A1: lib/prompts.js no longer exports getLibrary", () => {
  it("getLibrary is gone", () => {
    expect(prompts.getLibrary).toBeUndefined();
  });
  it("house-style and product-doc helpers still exported", () => {
    expect(typeof prompts.getHouseStyle).toBe("function");
    expect(typeof prompts.getProductDoc).toBe("function");
    expect(typeof prompts.getProductRole).toBe("function");
  });
});

describe("A1: manifest.json no longer ships prompts/library.json", () => {
  it("web_accessible_resources omits library.json", () => {
    const all = manifest.web_accessible_resources.flatMap((g) => g.resources);
    expect(all).not.toContain("prompts/library.json");
  });
  it("om-seeds and house-style still present", () => {
    const all = manifest.web_accessible_resources.flatMap((g) => g.resources);
    expect(all).toContain("prompts/om-seeds.json");
    expect(all).toContain("prompts/house-style.md");
  });
});

describe("A1: KEYS no longer holds the v2 library_override key", () => {
  // Indirect check: the only way external code referenced the v2 key was via
  // getLibraryOverride / setLibraryOverride. Both gone (tested above). We also
  // ensure no helper writes to "library_override".
  it("no storage helper touches the library_override key", async () => {
    await chrome.storage.local.clear();
    await storage.logDraft({ id: "x" });
    await storage.setDismissal("conv", Date.now());
    await storage.addTaxonomyValue("tones", "Curious");
    const all = await chrome.storage.local.get(null);
    expect(all).not.toHaveProperty("library_override");
  });
});
