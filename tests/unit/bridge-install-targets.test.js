import { describe, it, expect } from "vitest";
import { browserTargets, launcherName, HOST_NAME } from "../../bridge/install-targets.js";

describe("browserTargets — macOS", () => {
  const t = browserTargets("darwin", "/Users/me");
  const byName = (n) => t.find((x) => x.name === n);

  it("covers the Chromium family incl. Brave, Edge, Arc, Chromium", () => {
    const names = t.map((x) => x.name);
    expect(names).toEqual(
      expect.arrayContaining(["Google Chrome", "Brave", "Microsoft Edge", "Arc", "Chromium"])
    );
  });

  it("points Chrome at ~/Library/Application Support/Google/Chrome", () => {
    expect(byName("Google Chrome").baseDir).toBe(
      "/Users/me/Library/Application Support/Google/Chrome"
    );
    expect(byName("Google Chrome").manifestDir).toBe(
      "/Users/me/Library/Application Support/Google/Chrome/NativeMessagingHosts"
    );
  });

  it("points Brave at its own vendor dir (the bug that hid earlier)", () => {
    expect(byName("Brave").manifestDir).toBe(
      "/Users/me/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"
    );
  });
});

describe("browserTargets — Linux", () => {
  const t = browserTargets("linux", "/home/me");
  it("uses ~/.config vendor dirs", () => {
    const chrome = t.find((x) => x.name === "Google Chrome");
    expect(chrome.manifestDir).toBe("/home/me/.config/google-chrome/NativeMessagingHosts");
    const brave = t.find((x) => x.name === "Brave");
    expect(brave.manifestDir).toBe(
      "/home/me/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts"
    );
  });
});

describe("browserTargets — Windows", () => {
  const t = browserTargets("win32", "C:\\Users\\me");
  it("returns HKCU registry keys, not filesystem dirs", () => {
    expect(t.every((x) => x.regKey && !x.manifestDir)).toBe(true);
    expect(t.find((x) => x.name === "Google Chrome").regKey).toBe(
      "Software\\Google\\Chrome\\NativeMessagingHosts"
    );
  });
});

describe("launcherName + HOST_NAME", () => {
  it("is a .cmd on Windows and .sh elsewhere", () => {
    expect(launcherName("win32")).toBe("launch-host.cmd");
    expect(launcherName("darwin")).toBe("launch-host.sh");
    expect(launcherName("linux")).toBe("launch-host.sh");
  });
  it("uses the locked host name", () => {
    expect(HOST_NAME).toBe("com.optinmonster.claude_bridge");
  });
});

describe("browserTargets — unknown platform", () => {
  it("returns an empty list rather than throwing", () => {
    expect(browserTargets("sunos", "/home/me")).toEqual([]);
  });
});
