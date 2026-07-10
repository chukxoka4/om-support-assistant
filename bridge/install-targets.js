// Pure map of where each Chromium-family browser looks for native-messaging host
// manifests, per OS. No fs, no side effects — so it's unit-testable. The
// installer (install.js) filters these to the browsers actually present and
// writes the manifest into each.
//
// Sources: Chrome native-messaging docs (host location per platform) + each
// fork's documented user-data dir. Linux/Windows entries are written from docs
// and have NOT been verified on those platforms from this repo — the installer
// self-test is the real proof on each machine.

export const HOST_NAME = "com.optinmonster.claude_bridge";

// macOS: ~/Library/Application Support/<vendor>/NativeMessagingHosts
const MAC = [
  ["Google Chrome", "Google/Chrome"],
  ["Google Chrome Beta", "Google/Chrome Beta"],
  ["Google Chrome Canary", "Google/Chrome Canary"],
  ["Chromium", "Chromium"],
  ["Brave", "BraveSoftware/Brave-Browser"],
  ["Brave Beta", "BraveSoftware/Brave-Browser-Beta"],
  ["Microsoft Edge", "Microsoft Edge"],
  ["Arc", "Arc/User Data"],
];

// Linux: ~/.config/<vendor>/NativeMessagingHosts
const LINUX = [
  ["Google Chrome", "google-chrome"],
  ["Google Chrome Beta", "google-chrome-beta"],
  ["Chromium", "chromium"],
  ["Brave", "BraveSoftware/Brave-Browser"],
  ["Microsoft Edge", "microsoft-edge"],
];

// Windows: a per-user registry key whose default value points at the manifest
// file on disk. Vendors differ; the host manifest itself is shared.
const WINDOWS = [
  ["Google Chrome", "Software\\Google\\Chrome\\NativeMessagingHosts"],
  ["Chromium", "Software\\Chromium\\NativeMessagingHosts"],
  ["Brave", "Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts"],
  ["Microsoft Edge", "Software\\Microsoft\\Edge\\NativeMessagingHosts"],
];

const joinPosix = (...parts) => parts.join("/");

// Returns the candidate targets for a platform.
// darwin/linux: [{ name, baseDir, manifestDir }] — baseDir is the browser's
//   user-data root (its existence = the browser is installed); manifestDir is
//   where the host manifest json goes.
// win32: [{ name, regKey }] — the HKCU key to point at the manifest file.
export function browserTargets(platform, home) {
  if (platform === "darwin") {
    const root = joinPosix(home, "Library/Application Support");
    return MAC.map(([name, vendor]) => ({
      name,
      baseDir: joinPosix(root, vendor),
      manifestDir: joinPosix(root, vendor, "NativeMessagingHosts"),
    }));
  }
  if (platform === "linux") {
    const root = joinPosix(home, ".config");
    return LINUX.map(([name, vendor]) => ({
      name,
      baseDir: joinPosix(root, vendor),
      manifestDir: joinPosix(root, vendor, "NativeMessagingHosts"),
    }));
  }
  if (platform === "win32") {
    return WINDOWS.map(([name, regKey]) => ({ name, regKey }));
  }
  return [];
}

// The launcher filename per platform (a shim that execs an absolute node path so
// Chrome's minimal-PATH spawn still finds node).
export function launcherName(platform) {
  return platform === "win32" ? "launch-host.cmd" : "launch-host.sh";
}
