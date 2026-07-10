import { describe, it, expect } from "vitest";
import {
  AGENT_LABEL,
  buildPlist,
  buildDaemonLauncher,
  socketPath,
  daemonDir,
  daemonLogPath,
  daemonLauncherPath,
  plistPath,
  launchctlEnable,
  launchctlBootout,
  launchctlBootstrap,
  launchctlPrint,
  launchctlKickstart,
} from "../../bridge/launchd.js";

describe("launchd pure helpers", () => {
  it("keeps the unix socket path short (macOS sun_path cap is 104 bytes)", () => {
    const p = socketPath("/Users/someone");
    expect(p).toBe("/Users/someone/.om-claude-bridge/bridge.sock");
    expect(p.length).toBeLessThan(104);
  });

  it("derives dir/log/launcher/plist paths from one root", () => {
    expect(daemonDir("/Users/me")).toBe("/Users/me/.om-claude-bridge");
    expect(daemonLogPath("/Users/me")).toBe("/Users/me/.om-claude-bridge/daemon.log");
    expect(daemonLauncherPath("/Users/me")).toBe("/Users/me/.om-claude-bridge/daemon-launch.sh");
    expect(plistPath("/Users/me")).toBe(`/Users/me/Library/LaunchAgents/${AGENT_LABEL}.plist`);
  });
});

describe("buildDaemonLauncher", () => {
  const sh = buildDaemonLauncher({
    nodePath: "/Users/me/.nvm/versions/node/v20.18.0/bin/node",
    daemonPath: "/Users/me/repo/bridge/bridge-daemon.js",
    home: "/Users/me",
  });

  it("tries the captured node path first, then re-resolves", () => {
    expect(sh).toContain("NODE='/Users/me/.nvm/versions/node/v20.18.0/bin/node'");
    expect(sh).toContain("command -v node");
    expect(sh).toContain('/Users/me"/.nvm/versions/node/*/bin/node');
  });

  it("fails loudly (exit 1) when no node can be found", () => {
    expect(sh).toMatch(/no node found; re-run bridge\/install\.js.*\n\s*exit 1/);
  });

  it("execs the daemon with an absolute path", () => {
    expect(sh).toContain(`exec "$NODE" '/Users/me/repo/bridge/bridge-daemon.js'`);
  });
});

describe("buildPlist", () => {
  const plist = buildPlist({
    launcherPath: "/Users/me/.om-claude-bridge/daemon-launch.sh",
    logPath: "/Users/me/.om-claude-bridge/daemon.log",
  });

  it("launches via /bin/sh + the launcher (never a raw nvm node path)", () => {
    expect(plist).toContain("<string>/bin/sh</string>");
    expect(plist).toContain("<string>/Users/me/.om-claude-bridge/daemon-launch.sh</string>");
    expect(plist).not.toContain(".nvm");
  });

  it("restarts on crash but stays down after a clean exit (no flap loop)", () => {
    expect(plist).toMatch(/<key>SuccessfulExit<\/key>\s*<false\/>/);
    expect(plist).toMatch(/<key>ThrottleInterval<\/key>\s*<integer>10<\/integer>/);
    expect(plist).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/);
  });

  it("routes stdout+stderr to the log file", () => {
    const matches = plist.match(/\.om-claude-bridge\/daemon\.log/g) || [];
    expect(matches.length).toBe(2);
  });

  it("escapes XML-special characters in paths", () => {
    const odd = buildPlist({ launcherPath: "/x&y<z/launch.sh", logPath: "/l" });
    expect(odd).toContain("/x&amp;y&lt;z/launch.sh");
    expect(odd).not.toContain("/x&y<z/launch.sh");
  });
});

describe("launchctl argv builders", () => {
  it("targets the gui domain for the given uid", () => {
    expect(launchctlEnable(501)).toEqual(["launchctl", "enable", `gui/501/${AGENT_LABEL}`]);
    expect(launchctlBootout(501)).toEqual(["launchctl", "bootout", `gui/501/${AGENT_LABEL}`]);
    expect(launchctlBootstrap(501, "/p.plist")).toEqual(["launchctl", "bootstrap", "gui/501", "/p.plist"]);
    expect(launchctlPrint(501)).toEqual(["launchctl", "print", `gui/501/${AGENT_LABEL}`]);
    expect(launchctlKickstart(501)).toEqual(["launchctl", "kickstart", "-k", `gui/501/${AGENT_LABEL}`]);
  });
});
