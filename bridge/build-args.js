// Pure construction of the `claude` CLI invocation for one bridge request.
// No fs, no spawn, no env — just (request + resolved config) -> argv + cwd.
// Kept pure so mode selection, the read-only tool lockdown (DEC-G), and the
// KB-degradation matrix (DEC-F) are all unit-testable without a real CLI.
//
// Flags verified against the installed Claude Code CLI (v2.1.49, 2026-07-10):
//   -p --output-format json --system-prompt <s> --model <m>
//   --tools ""            -> disable ALL built-in tools (transform lockdown)
//   --tools "Read,Grep,Glob" -> ONLY these three exist (reason, read-only)
//   --no-session-persistence -> one-shot, nothing written to ~/.claude sessions
// NOTE: the docs-era `--max-turns` flag does NOT exist in this CLI version.
// Transform mode no longer needs it: `--tools ""` yields a single text turn.
// The user prompt is NOT an argv entry — the host pipes it via stdin (robust
// for long tickets, no ARG_MAX / shell-escaping concerns).

export const DEFAULT_MODEL = "claude-sonnet-4-6";

// Read-only tool set for reason mode. Excludes Write/Edit/Bash by construction
// (DEC-G): with `--tools` naming only these, the destructive tools do not exist
// in the session, so ticket text cannot land on disk or in the KB's git repo.
export const REASON_TOOLS = "Read,Grep,Glob";

// Resolve the mode actually executed given what's available on this machine.
// reason is only honoured when the KB is present; otherwise silent transform
// fallback (the teammate-without-a-KB degradation path, DEC-F).
export function resolveMode(requestedMode, kbAvailable) {
  return requestedMode === "reason" && kbAvailable ? "reason" : "transform";
}

// Build the `claude` argv (excluding the binary itself) and the cwd to spawn in.
// - system:        system prompt text (goes as --system-prompt)
// - model:         optional model id/alias; falls back to DEFAULT_MODEL
// - mode:          "transform" (default) | "reason"
// - kbRoot:        absolute path to the support-desk KB, or null/undefined
// - kbAvailable:   caller-computed boolean (host does the fs.existsSync)
// - transformCwd:  neutral dir to run transforms in (e.g. os.tmpdir()), so no
//                  project CLAUDE.md/settings get auto-loaded for a plain transform
export function buildClaudeInvocation({
  system,
  model,
  mode = "transform",
  kbRoot = null,
  kbAvailable = false,
  transformCwd,
}) {
  const effectiveMode = resolveMode(mode, kbAvailable);
  const resolvedModel = model || DEFAULT_MODEL;

  const args = [
    "-p",
    "--output-format",
    "json",
    "--no-session-persistence",
    "--system-prompt",
    system ?? "",
    "--model",
    resolvedModel,
  ];

  let cwd;
  if (effectiveMode === "reason") {
    // Only the read-only tools exist; run inside the KB so its CLAUDE.md +
    // patterns/drafts are reachable by Grep/Read/Glob.
    args.push("--tools", REASON_TOOLS, "--add-dir", kbRoot);
    cwd = kbRoot;
  } else {
    // No tools at all: a pure, stateless text transform.
    args.push("--tools", "");
    cwd = transformCwd;
  }

  return { args, cwd, effectiveMode, resolvedModel };
}
