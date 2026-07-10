# Claude Code bridge (native-messaging host + launchd daemon)

A tiny, **zero-dependency** Node bridge that lets the OM Support Assistant
extension run LLM calls through the locally-installed **Claude Code CLI** instead
of a third-party API key. The CLI authenticates with the agent's **Claude
Enterprise seat** (claude.ai OAuth), so customer ticket text reaches only
Anthropic under Awesome Motive's Enterprise agreement.

This folder lives **outside** the extension bundle — it is not served by
`manifest.json`. Full plan: [../docs/10-CLAUDE-CODE-CONNECTOR.md](../docs/10-CLAUDE-CODE-CONNECTOR.md);
decisions D34–D41 in [../docs/DECISIONS.md](../docs/DECISIONS.md).

## Architecture (macOS)

```
Browser (Brave/Chrome/…)
  └─ launch-host.sh → claude-bridge.js     (native-messaging HOST — a thin frame relay)
        │  unix socket ~/.om-claude-bridge/bridge.sock
        ▼
launchd user agent (com.optinmonster.claude_bridge_daemon)
  └─ daemon-launch.sh → bridge-daemon.js   (DAEMON — owns the claude spawns)
        └─ spawn: claude -p …              (Enterprise-seat OAuth)
```

**Why the daemon exists — the Gatekeeper popup.** `claude` extracts its bundled
ad-hoc-signed `ripgrep.node` into TMPDIR under a **random filename on every
run**. Files created by a browser-descended process tree get
`com.apple.quarantine`, so macOS showed a *"ripgrep.node … could not be
verified"* popup on **every** call — and "Allow Anyway" can never stick, because
approval is per-file and each run mints a new file. The daemon is launched by
**launchd**, outside the browser's process tree, so the files it creates carry
no quarantine and **the popup is gone permanently**. (Verified live: a
mid-flight `xattr` of a daemon-spawned extraction shows no quarantine attr.)

If the daemon is missing or down, the host **silently falls back** to spawning
`claude` directly (the original behavior) — everything still works; only the
popups can return. Linux/Windows never had the popup and always use direct mode.

The relay decodes and re-encodes frames (never raw byte piping), so a daemon
crash mid-request produces a clean framed error instead of a hung extension.
The daemon caps concurrent `claude` spawns globally (2) and kills orphans/
timeouts, so N browser profiles can't stampede the Enterprise seat.

## Prerequisites

- **Node** (any recent LTS; tested on v20). The generated launchers re-resolve
  node at runtime, so nvm/homebrew version bumps survive.
- **Claude Code CLI installed and logged in to the Enterprise seat.**
  Verify: `claude auth status` → `loggedIn: true`, `apiProvider: firstParty`.
- **`ANTHROPIC_API_KEY` unset** (the bridge strips it from spawns regardless).

## Install

```bash
# macOS / Linux (repo root)
node bridge/install.js <EXTENSION_ID>
```
```powershell
# Windows
node bridge\install.js <EXTENSION_ID>
```

Get `<EXTENSION_ID>` from `chrome://extensions` (or `brave://extensions`, …) →
Developer mode → Load unpacked → this repo → copy the ID (path-derived, same
across browsers on one machine).

The installer: preflights node/claude/login; writes/repairs `config.json`
(absolute `claudeBin` is required by the daemon); **installs + bootstraps the
launchd agent** (macOS); sweeps stale quarantined `.node` leftovers; installs
the host manifest into **every detected Chromium-family browser**; then
self-tests the full chain and asserts it routes **via the daemon**.

Flags: `--kb <path>` (KB root on first config), `--all` (manifests for all
supported browsers even if undetected), `--quick` (skip the live claude call),
`--no-daemon` (macOS: skip the agent — popups will recur).

Maintenance:

```bash
node bridge/install.js --doctor            # diagnose: plist / agent state / socket / routing
node bridge/install.js --uninstall-daemon  # remove the launchd helper
tail -f ~/.om-claude-bridge/daemon.log     # daemon log
```

> macOS shows a one-time **"background items added"** notice after install —
> that's this agent. It appears in System Settings → Login Items & Extensions,
> possibly under the **Node.js signer name**: leave it enabled. If the popup
> ever returns, the daemon has stopped — run `--doctor`.

## config.json (machine-local, gitignored)

```json
{
  "claudeBin": "/absolute/path/to/claude",
  "kbRoot": "/Users/you/Projects/support-desk"
}
```

`claudeBin` **must be absolute** (launchd's PATH is minimal; the daemon refuses
to start otherwise — the installer maintains this). `kbRoot` powers reason mode;
keep it **outside** macOS-privacy-protected folders (Documents/Desktop/
Downloads/iCloud) — a background agent can be TCC-denied there silently. The
daemon re-reads config.json per request (mtime check), so edits apply without a
restart.

## Protocol

4-byte little-endian length prefix + UTF-8 JSON, both directions, on stdio AND
on the daemon socket (`frame-codec.js`). Requests:
`{ system, user, model?, mode? }` (`mode`: `"transform"` no-tools default |
`"reason"` read-only KB search) or `{ ping: true }`. Replies: `{ text, mode }`,
`{ text: "", error }`, or `{ pong: true, ok, kb, daemon }` — `daemon: true`
means the reply came through the launchd path (popups eliminated); `kb: true`
means the KB is present **and readable** from the daemon.

## Test it standalone

```bash
node bridge/frame-call.js '{"ping":true}'   # expect …"daemon":true on macOS
node bridge/frame-call.js '{"system":"Fix spelling only. Return only the text.","user":"teh cat","mode":"transform"}'
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Gatekeeper "ripgrep.node" popup returns | Daemon stopped (Login Items toggle, node removed, crash loop) | `node bridge/install.js --doctor`, check `daemon.log`, re-run installer |
| "Native host has exited." | node not found by `launch-host.sh` | re-run installer (regenerates launchers) |
| "Specified native messaging host not found." | manifest missing for that browser / ID mismatch | re-run installer |
| Reply: `Not logged in · Please run /login` | Keychain login not visible | `claude auth login`; the daemon backfills HOME/USER/LOGNAME already |
| `bridge daemon busy` errors | >8 requests queued behind slow calls | wait; raise `maxConcurrent`/`maxQueued` in bridge-daemon.js if genuinely needed |
| kb shows unreadable in ping but the folder exists | TCC: KB under Documents/Desktop/iCloud | move the KB or grant access; see config section |
| Bootstrap error 125 / agent won't load | Login Items or MDM policy blocked it | System Settings → Login Items → enable; on managed Macs ask IT |

Upstream note: claude ≤2.1.49's own quarantine-strip helper skips
`linker-signed` libraries — exactly what its `ripgrep.node` is — which is why
the popup existed at all. Worth filing with Anthropic; if fixed upstream, the
daemon becomes optional (it still helps as a warm-path transport).

## CLI flags — tested version

Verified against **Claude Code v2.1.49** (2026-07-10), built in `build-args.js`:
- transform: `claude -p --output-format json --no-session-persistence --system-prompt <s> --model <m> --tools ""`
- reason: `… --tools "Read,Grep,Glob" --add-dir <kbRoot>` with `cwd = kbRoot`

`--max-turns` does not exist in v2.1.49 (`--tools ""` gives single-turn).
Reason mode's allowlist structurally excludes Write/Edit/Bash (DEC-G/D40).
Re-verify on every CLI bump (`claude --help`).

## Layer / architecture

All of `bridge/` is **layer-4 infrastructure** outside the extension:
`claude-bridge.js` (host/relay), `bridge-daemon.js` (launchd server),
`bridge-core.js` (shared spawn/request core), plus pure unit-tested helpers
`frame-codec.js`, `build-args.js`, `launchd.js`, `install-targets.js`.
Machine-local generated files (gitignored / outside the repo): `config.json`,
`launch-host.sh`, `~/.om-claude-bridge/{daemon-launch.sh,bridge.sock,daemon.log}`,
`~/Library/LaunchAgents/com.optinmonster.claude_bridge_daemon.plist`.
