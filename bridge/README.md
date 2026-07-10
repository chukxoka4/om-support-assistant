# Claude Code bridge (native-messaging host)

A tiny, **zero-dependency** Node script that lets the OM Support Assistant
extension run LLM calls through the locally-installed **Claude Code CLI** instead
of a third-party API key. The CLI authenticates with the agent's **Claude
Enterprise seat** (claude.ai OAuth), so customer ticket text reaches only
Anthropic under Awesome Motive's Enterprise agreement.

This folder lives **outside** the extension bundle — it is not served by
`manifest.json`. See [../docs/10-CLAUDE-CODE-CONNECTOR.md](../docs/10-CLAUDE-CODE-CONNECTOR.md)
for the full plan and [DEC-A…G in ../docs/DECISIONS.md](../docs/DECISIONS.md#d34--claude-code-is-the-default-provider-when-the-bridge-is-enabled).

## Prerequisites

- **Claude Code CLI installed and logged in to the Enterprise seat.**
  Verify: `claude auth status` should show `authMethod: claude.ai`,
  `apiProvider: firstParty`, and your Enterprise org.
- **`ANTHROPIC_API_KEY` unset** in the environment. If it's set, the CLI uses the
  personal API key instead of the Enterprise seat — which is exactly the
  data-governance problem this bridge exists to avoid. (The bridge also strips it
  from the child environment defensively.)
- Node (any recent LTS; tested on v20).

## Install (macOS)

```bash
bash bridge/install.sh
```

It will:
1. `chmod +x` the bridge.
2. Find `claude` and write `bridge/config.json` (`claudeBin`, optional `kbRoot`).
3. Prompt for this unpacked extension's ID (chrome://extensions → Developer mode).
4. Render the host manifest into
   `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.optinmonster.claude_bridge.json`.

Linux/Windows/Chromium paths are listed as a TODO at the end of `install.sh`.

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

Request:
```jsonc
{ "system": "…", "user": "…", "model": "claude-sonnet-4-6", "mode": "transform" }
// mode: "transform" (default, no tools) | "reason" (read-only KB search)
{ "ping": true }   // health check
```
Reply:
```jsonc
{ "text": "…", "mode": "transform" }      // success
{ "text": "", "error": "…" }              // failure
{ "pong": true, "ok": true, "kb": true }  // ping response (kb = KB folder present)
```

## Test it standalone

The `frame-call.js` dev harness frames a JSON request, pipes it into the bridge,
and prints the decoded reply. Run these from the repo root:

```bash
# health check — expect: {"pong":true,"ok":true,"kb":<bool>}
node bridge/frame-call.js '{"ping":true}'

# transform (no tools) — expect the corrected sentence back
node bridge/frame-call.js '{"system":"You are a copy editor. Fix spelling and grammar only. Return only the corrected text.","user":"teh cat sat on teh mat and it dont move","mode":"transform"}'

# reason (needs kbRoot set + present) — searches the KB before answering
node bridge/frame-call.js '{"system":"If a local knowledge base is available, grep patterns/INDEX.md for the symptom before answering.","user":"How do I test a geo-location rule without a VPN?","mode":"reason"}'
```

## CLI flags — tested version

Verified against **Claude Code v2.1.49** (2026-07-10). The bridge builds its
invocation in `build-args.js`:

- transform: `claude -p --output-format json --no-session-persistence --system-prompt <s> --model <m> --tools ""`
- reason:    `… --tools "Read,Grep,Glob" --add-dir <kbRoot>` with `cwd = kbRoot`

Notes for whoever bumps the CLI version:
- The docs-era `--max-turns` flag **does not exist** in v2.1.49. `--tools ""`
  gives a single-turn pure transform without it. Re-check `claude --help` on
  every version bump (flags drift).
- `--tools "Read,Grep,Glob"` (reason mode) names the *only* built-in tools that
  exist in the session — Write/Edit/Bash are structurally absent (DEC-G). This
  is the PII guarantee; re-verify it survives CLI upgrades.

## Layer / architecture

`claude-bridge.js` is **layer-4 infrastructure** (same contract as
`providers/*.js`: strings in, `{ text }` / `{ text: "", error }` out) but its
transport is native-messaging stdio instead of `fetch`. `frame-codec.js` and
`build-args.js` are pure and unit-tested
(`tests/unit/frame-codec.test.js`, `tests/unit/bridge-build-args.test.js`).
