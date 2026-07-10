# Upstream bug (to file with Anthropic) — Claude Code ripgrep.node Gatekeeper loop

**Status:** documented, NOT yet filed. File at
<https://github.com/anthropics/claude-code/issues> (public repo, issues enabled —
anyone with a GitHub account can open one). Verified against **Claude Code
v2.1.49**, macOS (Darwin 25.x), Apple Silicon, on 2026-07-10.

**Why it matters to us:** this is the root cause of the recurring Gatekeeper
popup that drove [Slice 8](10-CLAUDE-CODE-CONNECTOR.md) (the launchd daemon).
If Anthropic fixes it, the launchd daemon becomes optional (keep it as the
warm-path transport). Until then, the daemon is our workaround.

---

## Evidence captured on this machine (reproduce before filing if versions moved)

```
$ claude --version
2.1.49 (Claude Code)

# a freshly-extracted ripgrep.node during a run:
$ codesign -dvvv <captured>.node
Identifier=ripgrep.node
CodeDirectory v=20400 size=48040 flags=0x20002(adhoc,linker-signed) …
Signature=adhoc
TeamIdentifier=not set

# the CLI's own quarantine-strip helper (strings of the binary; src/utils/ripgrep.ts):
…find((B)=>B.includes("linker-signed")))return;      // ← early-return
try{
  await WA("codesign",["--sign","-","--force","--preserve-metadata=entitlements,requirements,flags,runtime",R]);
  await WA("xattr",["-d","com.apple.quarantine",R]);   // ← never reached for linker-signed
}catch(B){r(B)}
```

The extracted module is `adhoc,linker-signed`, so `.includes("linker-signed")`
fires and the helper returns **before** `xattr -d com.apple.quarantine` — the
quarantine bit it exists to remove is never removed.

Extraction happens on **every** `claude -p` run (even `--tools ""`), to a
**random** hidden filename `$TMPDIR/.<16-hex>-00000000.node`, and is deleted on
clean exit. Terminal-launched runs never prompt (Terminal isn't
quarantine-propagating); only runs descended from a quarantine-enabled GUI app
(a browser, via a native-messaging host) do — because the child's files inherit
`com.apple.quarantine`. "Allow Anyway" can never persist: approval is per-file
and every run mints a new filename.

---

## Ready-to-paste issue

**Title:** macOS: recurring Gatekeeper "ripgrep.node could not be verified" when `claude -p` is spawned by a browser (native-messaging host) — quarantine-strip helper skips linker-signed modules

**Body:**

### Summary
On macOS, when the Claude Code CLI is launched by a process descended from a quarantine-enabled app (e.g. a Chrome/Brave **native-messaging host**), every `claude -p` invocation triggers a Gatekeeper *"'.…node' could not be verified free of malware"* dialog for the bundled `ripgrep.node`. It recurs on **every run** and cannot be dismissed permanently. The CLI already ships a helper meant to prevent this (re-sign + strip quarantine), but it **early-returns for `linker-signed` binaries** — and the extracted `ripgrep.node` is exactly `adhoc,linker-signed`, so the fix never runs on the one file that needs it.

### Environment
- Claude Code **v2.1.49** (native install)
- macOS (Darwin 25.x), Apple Silicon
- Launcher: a Node native-messaging host spawned by Brave/Chrome, which spawns `claude -p`

### Reproduction
1. Register a Chrome/Brave native-messaging host that runs `claude -p --output-format json --tools "" "hi"`.
2. Trigger it from the extension (so `claude` is a descendant of the browser).
3. A Gatekeeper dialog appears for a hidden `~/.../T/.<16-hex>-00000000.node`.
4. Click "Done" / approve via System Settings → it reappears on the **next** call.

Runs of the same command from **Terminal** never prompt, localizing it to quarantine inheritance + the ineffective strip.

### Root cause (verified in the v2.1.49 binary)
1. `ripgrep.node` (Bun-embedded N-API addon) is extracted to `$TMPDIR` under a **random filename every run** — even with `--tools ""`.
2. Files created under a browser process tree inherit `com.apple.quarantine`; the ad-hoc-signed module is then blocked by Gatekeeper on `dlopen`.
3. "Allow Anyway" can never persist: approval is per-file, each run mints a new filename.
4. **The bug:** the remediation in `src/utils/ripgrep.ts` does
   ```js
   …find((B) => B.includes("linker-signed"))) return;
   // otherwise: codesign --sign - --force …  then  xattr -d com.apple.quarantine
   ```
   The module is `CodeDirectory … flags=0x20002(adhoc,linker-signed)`, so the guard fires and the function returns **before** the `xattr -d com.apple.quarantine` call.

### Impact
Any integration that runs `claude -p` from a GUI-app-descended process on macOS (browser extensions/native-messaging hosts, some Electron/Tauri wrappers, automation launched from a quarantine-enabled parent) gets an unactionable Gatekeeper popup on every invocation.

### Suggested fixes (any one)
1. **Decouple the two operations:** even when `linker-signed` (skip the re-sign to avoid disturbing a managed signature), **still run `xattr -d com.apple.quarantine`** — that's the part these files need and it's safe.
2. **Notarize / stably re-sign** the embedded `ripgrep.node`, and/or extract it to a **content-addressed stable path** so a one-time Gatekeeper approval can persist.
3. Narrow the guard so it only skips genuinely notarized/Developer-ID signatures, not `adhoc,linker-signed` ones.

### Workaround
Move the `claude -p` spawn out of the browser's process tree (e.g. a launchd user agent that the browser host relays to over a unix socket). Files created by a launchd-descended process aren't quarantined, so the popup disappears — a heavy per-integration workaround for what looks like a one-line fix in the helper.

---

## When filing
- Post as yourself; it lands under your GitHub account.
- Re-run the evidence block first if the installed CLI version has changed — the
  guard/flags may differ.
- Link back here is unnecessary (this file is internal); include the evidence
  block inline in the issue.
