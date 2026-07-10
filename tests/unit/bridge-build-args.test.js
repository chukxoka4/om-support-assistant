import { describe, it, expect } from "vitest";
import {
  buildClaudeInvocation,
  buildChildEnv,
  resolveMode,
  DEFAULT_MODEL,
  REASON_TOOLS,
} from "../../bridge/build-args.js";

// Read the value that follows a flag in an argv array.
const valAfter = (args, flag) => args[args.indexOf(flag) + 1];

describe("resolveMode", () => {
  it("honours reason only when the KB is available", () => {
    expect(resolveMode("reason", true)).toBe("reason");
    expect(resolveMode("reason", false)).toBe("transform");
    expect(resolveMode("transform", true)).toBe("transform");
    expect(resolveMode(undefined, true)).toBe("transform");
  });
});

describe("buildClaudeInvocation — transform (default)", () => {
  const inv = buildClaudeInvocation({
    system: "you are a copy editor",
    user: "ignored (goes via stdin)",
    transformCwd: "/tmp/neutral",
  });

  it("is a no-tools, json, print, non-persistent call", () => {
    expect(inv.args).toContain("-p");
    expect(valAfter(inv.args, "--output-format")).toBe("json");
    expect(inv.args).toContain("--no-session-persistence");
    expect(valAfter(inv.args, "--tools")).toBe(""); // all tools disabled
  });

  it("does NOT pass the nonexistent --max-turns flag", () => {
    expect(inv.args).not.toContain("--max-turns");
  });

  it("passes system as a flag and defaults the model", () => {
    expect(valAfter(inv.args, "--system-prompt")).toBe("you are a copy editor");
    expect(valAfter(inv.args, "--model")).toBe(DEFAULT_MODEL);
  });

  it("runs in the neutral cwd, not the KB", () => {
    expect(inv.cwd).toBe("/tmp/neutral");
    expect(inv.effectiveMode).toBe("transform");
    expect(inv.args).not.toContain("--add-dir");
  });

  it("honours an explicit model", () => {
    const i = buildClaudeInvocation({ system: "s", model: "claude-opus-4-8", transformCwd: "/tmp" });
    expect(valAfter(i.args, "--model")).toBe("claude-opus-4-8");
  });
});

describe("buildClaudeInvocation — reason (DEC-F/G)", () => {
  it("runs read-only in the KB when available", () => {
    const inv = buildClaudeInvocation({
      system: "draft with the KB",
      mode: "reason",
      kbRoot: "/Users/me/Projects/support-desk",
      kbAvailable: true,
      transformCwd: "/tmp",
    });
    expect(inv.effectiveMode).toBe("reason");
    expect(inv.cwd).toBe("/Users/me/Projects/support-desk");
    expect(valAfter(inv.args, "--tools")).toBe(REASON_TOOLS);
    expect(valAfter(inv.args, "--add-dir")).toBe("/Users/me/Projects/support-desk");
  });

  it("read-only lockdown excludes Write/Edit/Bash (DEC-G)", () => {
    const inv = buildClaudeInvocation({
      system: "s",
      mode: "reason",
      kbRoot: "/kb",
      kbAvailable: true,
      transformCwd: "/tmp",
    });
    const tools = valAfter(inv.args, "--tools");
    expect(tools).toBe("Read,Grep,Glob");
    expect(tools).not.toMatch(/Write|Edit|Bash/);
  });

  it("falls back to transform when the KB folder is missing", () => {
    const inv = buildClaudeInvocation({
      system: "s",
      mode: "reason",
      kbRoot: "/Users/me/Projects/support-desk",
      kbAvailable: false,
      transformCwd: "/tmp",
    });
    expect(inv.effectiveMode).toBe("transform");
    expect(valAfter(inv.args, "--tools")).toBe("");
    expect(inv.cwd).toBe("/tmp");
    expect(inv.args).not.toContain("--add-dir");
  });

  it("falls back to transform when kbRoot is unset (default install)", () => {
    const inv = buildClaudeInvocation({ system: "s", mode: "reason", transformCwd: "/tmp" });
    expect(inv.effectiveMode).toBe("transform");
  });
});

describe("buildChildEnv", () => {
  it("strips the keys that would bypass the Enterprise seat or trip the guard", () => {
    const env = buildChildEnv(
      {
        ANTHROPIC_API_KEY: "sk-personal",
        ANTHROPIC_AUTH_TOKEN: "tok",
        CLAUDECODE: "1",
        CLAUDE_CODE_SSE_PORT: "5000",
        HOME: "/Users/me",
        PATH: "/usr/bin",
      },
      { userInfo: { username: "me", homedir: "/Users/me" }, claudeBin: "/opt/claude/bin/claude" }
    );
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.CLAUDECODE).toBeUndefined();
    expect(env.CLAUDE_CODE_SSE_PORT).toBeUndefined();
  });

  it("backfills HOME/USER/LOGNAME from userInfo when Chrome's env omits them", () => {
    const env = buildChildEnv(
      { PATH: "/usr/bin" },
      { userInfo: { username: "me", homedir: "/Users/me" }, claudeBin: "/bin/claude" }
    );
    expect(env.HOME).toBe("/Users/me");
    expect(env.USER).toBe("me");
    expect(env.LOGNAME).toBe("me");
  });

  it("does not clobber identity vars that are already present", () => {
    const env = buildChildEnv(
      { HOME: "/keep", USER: "real", LOGNAME: "real", PATH: "/usr/bin" },
      { userInfo: { username: "other", homedir: "/other" }, claudeBin: "" }
    );
    expect(env.HOME).toBe("/keep");
    expect(env.USER).toBe("real");
  });

  it("ensures a usable PATH including the claude binary's directory", () => {
    const env = buildChildEnv(
      { PATH: "/custom" },
      { userInfo: {}, claudeBin: "/Users/me/.local/bin/claude" }
    );
    const parts = env.PATH.split(":");
    expect(parts).toContain("/custom");
    expect(parts).toContain("/usr/bin");
    expect(parts).toContain("/bin");
    expect(parts).toContain("/Users/me/.local/bin");
  });

  it("builds a PATH from scratch when the base env has none", () => {
    const env = buildChildEnv({}, { userInfo: {}, claudeBin: "claude" });
    expect(env.PATH.split(":")).toContain("/usr/bin");
    // a bare 'claude' (no slash) contributes no directory
    expect(env.PATH).not.toContain("claude");
  });
});
