# 11 — Session handoff (2026-07-10): Claude Code connector, built end-to-end

Read this to resume the Claude Code connector work in a **fresh session / fresh
agent**. It's the narrative + hard-won facts that tie together the durable
records: the plan/status is [10-CLAUDE-CODE-CONNECTOR.md](10-CLAUDE-CODE-CONNECTOR.md),
the decisions are [DECISIONS.md](DECISIONS.md) **D34–D41**, the provenance row is
[SESSION-HISTORY.md](SESSION-HISTORY.md).

**Branch:** all work is on `joseph-dev`. The owner's standing directive this
session: **stay on `joseph-dev`, no branching.**

---

## What got built (Slices 0–8, all done)

A key-less `claude-code` LLM provider that routes every extension LLM call
through the local **Claude Code CLI on the Awesome Motive Enterprise seat**
(claude.ai OAuth, no API key) — lifting the data-governance **pend** on
LLM features. Slice map (full detail + acceptance in doc 10):

| Slice | What | Key files |
|---|---|---|
| 0 | Ratify DEC-A…E → D34–D38 | DECISIONS.md |
| 1 | Zero-dep native-messaging **bridge** | `bridge/{claude-bridge,frame-codec,build-args}.js` |
| 2 | Key-less provider + dispatcher + manifest | `providers/claude-code.js`, `providers/index.js`, `manifest.json` |
| 3 | Availability / default-resolution / third-party gate | `lib/storage.js` |
| 4 | Options UI (Test connection + gate) | `options.html/js` |
| (fix) | Side-panel Settings parity | `sidepanel.html/js` |
| 5 | Provider-aware polish timeout; **pend lifted** | `lib/text-polish.js` |
| 6 | KB reasoning layer (reason mode) | `lib/compose.js`, `lib/voice.js` |
| 7 | Error surfacing + docs sweep (connectNative deferred) | `lib/bridge-error-hint.js` |
| 8 | **launchd daemon** — kills the macOS Gatekeeper popup | `bridge/{bridge-daemon,bridge-core,launchd}.js` |

Test suite grew 419 → **496**, all green. `npm test` is the gate.

---

## Current runtime state on the owner's machine (already installed)

- **Extension ID** (unpacked, path-derived, same across browsers):
  `ngmegpnghlkllllhkomcbjkmpigiopnb`
- **Host manifests** installed for Chrome, Chromium, Brave, Edge, Arc. Owner's
  daily browser is **Brave**.
- **launchd agent** `com.optinmonster.claude_bridge_daemon` running (gui/501);
  socket `~/.om-claude-bridge/bridge.sock`; log `~/.om-claude-bridge/daemon.log`.
- **`bridge/config.json`** (gitignored): `claudeBin=/Users/nwachukwuokafor/.local/bin/claude`,
  `kbRoot=/Users/nwachukwuokafor/Projects/support-desk`.
- Confirmed working: Options → Test connection is green; drafting routes via the
  daemon; **the Gatekeeper popup is gone** (owner: "working clean now").
- Machine-local generated files (gitignored / outside repo): `bridge/config.json`,
  `bridge/launch-host.sh`, `~/.om-claude-bridge/{daemon-launch.sh,bridge.sock,daemon.log}`,
  `~/Library/LaunchAgents/com.optinmonster.claude_bridge_daemon.plist`.

**Resume/verify commands:**
```bash
npm test                                   # 496 green
node bridge/install.js --doctor            # plist / agent / socket / routing
node bridge/frame-call.js '{"ping":true}'  # expect …"daemon":true
node bridge/install.js <EXTENSION_ID>      # re-install (idempotent) after node upgrades etc.
```

---

## Hard-won facts (don't re-discover these the hard way)

**Claude Code CLI (v2.1.49) flags — verified against the installed binary:**
- No `--max-turns` in this version. Transform mode uses `--tools ""` (disables
  ALL tools → single text turn). Reason mode uses `--tools "Read,Grep,Glob"
  --add-dir <kbRoot>` with `cwd=kbRoot`. Re-verify with `claude --help` on any
  version bump — flags drift.
- Result JSON: `{ subtype:"success", is_error, result:"<text>", … }`;
  `result.result` is the text. `is_error:true` with `result:"Not logged in …"`
  when the Keychain login isn't visible to the spawned process.
- `claude` is a self-contained Mach-O (Bun); runs fine under a minimal PATH.
- Auth: `claude auth status` → `loggedIn`, `apiProvider:"firstParty"`,
  `orgName:"Awesome Motive Enterprise"`. `ANTHROPIC_API_KEY` unset = Enterprise
  seat; if set, it silently uses the personal key (bridge strips it from spawns).

**macOS native-messaging + Gatekeeper (the Slice-8 saga):**
- Chrome/Brave launch native hosts with a **minimal PATH** → a
  `#!/usr/bin/env node` shebang fails when node is nvm/homebrew ("Native host
  has exited"). Fix: a `/bin/sh` launcher with an absolute (re-resolving) node
  path. This machine's node is **nvm** (`~/.nvm/versions/node/v20.18.0/bin/node`).
- A sparse env also makes `claude` miss its **Keychain** login ("Not logged in")
  → the bridge backfills `HOME/USER/LOGNAME` + PATH (`build-args.js buildChildEnv`).
- **The popup:** `claude` extracts `ripgrep.node` (ad-hoc, **linker-signed**) to
  `$TMPDIR` under a random name every run; browser-descended processes inherit
  `com.apple.quarantine`; approval is per-file so it never sticks. Root cause is
  an upstream bug — see [UPSTREAM-BUG-claude-code-ripgrep-quarantine.md](UPSTREAM-BUG-claude-code-ripgrep-quarantine.md).
- **The fix (D41):** run `claude` from a **launchd** agent, outside the browser
  tree → files aren't quarantined. Proven: a mid-flight `xattr` of the
  daemon-spawned `.node` shows **no quarantine attr**. Quarantine has **no**
  socket/IPC "responsible process" transfer (that's a TCC concept), so the
  browser connecting to the daemon's socket does NOT re-quarantine.
- **KB is NOT a git repo** — the DEC-G PII check is a **no-new-files + content-
  hash scan**, not `git status` (verified byte-identical after a reason run).
- **TCC:** a launchd agent is its own privacy identity — a KB under
  Documents/Desktop/Downloads/iCloud can be readable from Terminal yet denied
  for the daemon. Keep `kbRoot` in a plain path (`~/Projects/…`). The daemon's
  ping reports `kb` = present **and readable**.

**Process notes:** Slice 8 went through an **adversarial design review** (3
lenses, premise empirically confirmed) BEFORE building and an **adversarial code
review** (18 findings, 15 confirmed by independent verifiers — 1 critical, 5
major) AFTER, all fixed same-day. Worth repeating for anything this fiddly.

---

## Open items / next steps (nothing blocking; pick up any)

1. **Live 5-flow smoke (Slice 5 acceptance)** — owner's Chrome: compose →
   retone/translate → managerial-rewrite suggestion → ranker LLM toggle → full
   report with a deliberate typo (prove it's polished, not silent-fallback).
   Everything routes through the proven bridge transform; this is confirmation.
2. **CLARIFY gate** (owner-requested) — the extension's compose is a one-shot
   headless call, so the owner's "ask when unclear" gates can't fire
   interactively. Buildable as: when the ticket is ambiguous/missing info, the
   model returns a `CLARIFY:` block (what it needs) instead of guessing a draft;
   the side panel surfaces it. Small: compose prompt + a render branch + a test.
   See [OPEN-THREADS.md](OPEN-THREADS.md).
3. **Live doc-link validation** (owner-asked) — reason mode has no web tools, so
   it can't verify doc URLs; it cites KB-verified ones. Optionally enable
   `WebFetch` on the daemon, gated to validate links already present (network
   egress + latency tradeoff). See OPEN-THREADS.
4. **Skills in reason mode** — reason mode's allowlist is `Read,Grep,Glob`, so
   skills can't *run* (needs `Skill`/often `Bash`/`Write`, which break DEC-G's
   read-only PII guarantee); the model can Read a `SKILL.md` as reference, and
   support-desk's `CLAUDE.md` **is** auto-loaded (cwd=KB). Only enable a specific
   skill if it's provably Read/Grep-only. See OPEN-THREADS.
5. **File the upstream bug** with Anthropic (draft ready in the upstream-bug
   doc). Public repo; owner posts under their account (do NOT auto-post).
6. **connectNative warm port (Slice 7, deliberately deferred)** — the daemon's
   framed socket protocol already makes this a transport-only change if latency
   ever matters. Rationale for deferral is in doc 10 Slice 7.

---

## Things a fresh agent must NOT get wrong

- **Stay on `joseph-dev`; do not branch** (owner directive).
- **DEC-G is structural:** never add `Write`/`Edit`/`Bash` to reason mode's
  allowlist — that's the guarantee that customer ticket text can't reach the KB.
- **Don't auto-post** anything to GitHub / send anything outward — the upstream
  bug is owner-posted.
- The pre-commit hook blocks `lib/`/`providers/`/entry-point commits without a
  `tests/` change. Never `--no-verify` without explicit approval.
- `bridge/config.json`, `bridge/launch-host.sh`, `bridge/host-manifest.win.json`,
  `bridge/launch-host.cmd` are gitignored (machine-local). Don't commit them.
