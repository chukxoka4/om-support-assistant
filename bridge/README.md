# Claude Code bridge (native-messaging host)

A tiny, **zero-dependency** Node script that lets the OM Support Assistant
extension run LLM calls through the locally-installed **Claude Code CLI** instead
of a third-party API key. The CLI authenticates with the agent's **Claude
Enterprise seat** (claude.ai OAuth), so customer ticket text reaches only
Anthropic under Awesome Motive's Enterprise agreement.

This folder lives **outside** the extension bundle — it is not served by
`manifest.json`. See [../docs/10-CLAUDE-CODE-CONNECTOR.md](../docs/10-CLAUDE-CODE-CONNECTOR.md)
for the full plan and [DEC-A…G in ../docs/DECISIONS.md](../docs/DECISIONS.md).

## Prerequisites

- **Node** (any recent LTS; tested on v20). The installer runs under Node and
  reuses that exact node path, so nvm/homebrew installs are fine.
- **Claude Code CLI installed and logged in to the Enterprise seat.**
  Verify: `claude auth status` → `loggedIn: true`, `apiProvider: firstParty`,
  your Enterprise org. If not, `claude auth login`.
- **`ANTHROPIC_API_KEY` unset.** If set, `claude` would use that personal key
  instead of the Enterprise seat — the exact data-governance problem this bridge
  avoids. (The bridge strips it from the spawned process regardless, but unset it
  in your shell too if you use `claude` interactively.)

## Install

One command, from the repo root. It preflights your setup, installs the host
manifest into **every Chromium-family browser it finds** (Chrome, Chrome
Beta/Canary, Chromium, Brave, Edge, Arc), and runs a **live self-test** so a
broken setup fails here — with a clear message — not later.

```bash
# macOS / Linux
bash bridge/install.sh <EXTENSION_ID>
# …or directly, any OS:
node bridge/install.js <EXTENSION_ID>
```
```powershell
# Windows
node bridge\install.js <EXTENSION_ID>
```

Get `<EXTENSION_ID>` from `chrome://extensions` (or `brave://extensions`, etc.)
→ Developer mode → Load unpacked → this repo folder → copy the ID. The ID is
derived from the folder **path**, so it's the same across browsers on one
machine.

Flags: `--kb <path>` (set the KB root when first creating `config.json`),
`--all` (write manifests for every supported browser even if not detected),
`--quick` (skip the live `claude` call in the self-test — ping only).

> **After changing `manifest.json` permissions** (e.g. adding `nativeMessaging`)
> **reload the extension** before testing. Re-running the installer (manifest /
> launcher changes) does **not** need a reload.

### Platform notes / honesty

- **macOS** is fully exercised. **Linux** paths (`~/.config/<vendor>/…`) and the
  **Windows** registry path (`HKCU\Software\<vendor>\NativeMessagingHosts`) are
  written from Chrome's native-messaging docs but haven't been run from this
  repo — the installer's **self-test is the real proof on each machine**. If the
  self-test passes, the transport works there.

## config.json (machine-local, gitignored)

```json
{
  "claudeBin": "/absolute/path/to/claude",
  "kbRoot": "/Users/you/Projects/support-desk"
}
```

Machine paths never enter the extension or `chrome.storage`. `kbRoot` is only
used by **reason mode** (Slice 6); if it's unset or the folder is missing, the
bridge silently runs every call as a plain transform.

## Protocol

4-byte little-endian length prefix + UTF-8 JSON, **both directions**
(Chrome native-messaging framing — see `frame-codec.js`).

Request `{ system, user, model?, mode? }` — `mode`: `"transform"` (default, no
tools) | `"reason"` (read-only KB search). `{ ping: true }` for a health check.
Reply `{ text, mode }` on success, `{ text: "", error }` on failure,
`{ pong: true, ok: true, kb }` to a ping.

## Test it standalone

```bash
node bridge/frame-call.js '{"ping":true}'
node bridge/frame-call.js '{"system":"Fix spelling only. Return only the text.","user":"teh cat","mode":"transform"}'
```

## Troubleshooting (what you or a teammate may hit)

| Symptom | Cause | Fix |
|---|---|---|
| **"Native host has exited."** | `node` not on Chrome's minimal PATH (e.g. nvm). | Handled: the manifest points at `launch-host.sh/.cmd`, which hardcodes the absolute node path. Re-run the installer if you switched node versions. |
| **"Specified native messaging host not found."** | Manifest not in *that* browser's dir, or ID mismatch. | Re-run the installer (it does all detected browsers). Confirm the loaded extension's ID matches. |
| **Reply: `Not logged in · Please run /login`** | `claude`'s Keychain login isn't visible to the spawned process (sparse env). | Handled: the bridge backfills `HOME`/`USER`/`LOGNAME`. If it persists, run `claude auth login`. |
| **Reply routes to a personal key** | `ANTHROPIC_API_KEY` set. | The bridge strips it; unset it in your shell too. |
| **macOS: "ripgrep.node … could not be verified"** | Claude Code's **bundled ripgrep** (ad-hoc signed) is extracted to `$TMPDIR` on each run; a browser-launched process gets it quarantined. Not this extension. | See below. |

### The macOS "ripgrep.node" Gatekeeper notice

Every macOS user will see this the first time(s) the bridge runs a call under a
browser. It is **Claude Code's own search engine**, not this project — the same
`ripgrep` your `claude` uses in the terminal. It's safe to allow if you trust
your Claude Code install.

- Click **Done** (never "Move to Bin").
- To stop it blocking **reason mode** (which uses ripgrep for KB search):
  **System Settings → Privacy & Security → “Allow Anyway”**, then re-run once and
  choose **Open**.
- Transform-only flows (draft polish, retone/translate, suggestions, ranker)
  don't use ripgrep, so a still-blocked ripgrep won't affect them.
- If it keeps recurring and you want it gone, you can clear the quarantine bit on
  the extracted files yourself (they're recreated each run, so this is best-effort):
  `xattr -d com.apple.quarantine "$TMPDIR".*.node` — a security-attribute change,
  so run it only if you understand it.

## CLI flags — tested version

Verified against **Claude Code v2.1.49** (2026-07-10). Built in `build-args.js`:

- transform: `claude -p --output-format json --no-session-persistence --system-prompt <s> --model <m> --tools ""`
- reason:    `… --tools "Read,Grep,Glob" --add-dir <kbRoot>` with `cwd = kbRoot`

The docs-era `--max-turns` flag does **not** exist in v2.1.49; `--tools ""` gives
a single-turn transform without it. `--tools "Read,Grep,Glob"` (reason) names the
*only* built-in tools that exist — Write/Edit/Bash are structurally absent
(DEC-G). Re-verify both on every CLI version bump (`claude --help`).

## Layer / architecture

`claude-bridge.js` is **layer-4 infrastructure** (strings in, `{ text }` /
`{ text: "", error }` out) with a native-messaging transport. Pure, unit-tested
helpers: `frame-codec.js` (framing), `build-args.js` (argv + child env),
`install-targets.js` (per-OS browser locations).
