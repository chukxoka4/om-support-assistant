#!/usr/bin/env bash
# Register the OM Support Assistant Claude Code bridge as a Chrome
# native-messaging host. macOS-first (this team is on macOS).
#
# What it does:
#   1. Resolves the absolute path to claude-bridge.js and makes it executable.
#   2. Finds the `claude` CLI and writes bridge/config.json (claudeBin [+ kbRoot]).
#   3. Prompts for this unpacked extension's ID.
#   4. Renders host-manifest.template.json into Chrome's NativeMessagingHosts dir.
#
# Re-runnable: overwrites the host manifest, leaves an existing config.json alone
# unless you confirm.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRIDGE_PATH="$HERE/claude-bridge.js"
HOST_NAME="com.optinmonster.claude_bridge"

echo "OM Support Assistant — Claude Code bridge installer"
echo "Bridge: $BRIDGE_PATH"
echo

# --- 1. make the bridge executable ------------------------------------------
chmod +x "$BRIDGE_PATH"

# --- 2. locate claude + write config.json -----------------------------------
CLAUDE_BIN="$(command -v claude || true)"
if [[ -z "$CLAUDE_BIN" ]]; then
  echo "WARNING: 'claude' not found on PATH. Install Claude Code and log in to your"
  echo "Enterprise seat (claude auth login), then set claudeBin in bridge/config.json."
  CLAUDE_BIN="claude"
else
  echo "Found claude: $CLAUDE_BIN"
fi

CONFIG_PATH="$HERE/config.json"
if [[ -f "$CONFIG_PATH" ]]; then
  echo "config.json already exists — leaving it untouched."
else
  read -r -p "Path to your support-desk KB (optional, blank to skip): " KB_ROOT
  {
    echo "{"
    echo "  \"claudeBin\": \"$CLAUDE_BIN\""
    if [[ -n "${KB_ROOT:-}" ]]; then
      echo "  ,\"kbRoot\": \"$KB_ROOT\""
    fi
    echo "}"
  } > "$CONFIG_PATH"
  echo "Wrote $CONFIG_PATH"
fi

# --- 3. extension ID ---------------------------------------------------------
read -r -p "Unpacked extension ID (chrome://extensions, Developer mode): " EXT_ID
if [[ -z "${EXT_ID:-}" ]]; then
  echo "ERROR: extension ID is required." >&2
  exit 1
fi

# --- 4. render + install the host manifest -----------------------------------
# macOS Chrome. See TODO below for Chromium / Chrome Canary / Linux / Windows.
TARGET_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
mkdir -p "$TARGET_DIR"
TARGET="$TARGET_DIR/$HOST_NAME.json"

sed -e "s#__BRIDGE_PATH__#$BRIDGE_PATH#" \
    -e "s#__EXTENSION_ID__#$EXT_ID#" \
    "$HERE/host-manifest.template.json" > "$TARGET"

echo
echo "Installed host manifest: $TARGET"
echo "Done. Reload the extension, then use options → Test connection."
echo
echo "# TODO (other platforms):"
echo "#   Chromium:      ~/Library/Application Support/Chromium/NativeMessagingHosts/"
echo "#   Chrome Canary: ~/Library/Application Support/Google/Chrome Canary/NativeMessagingHosts/"
echo "#   Linux Chrome:  ~/.config/google-chrome/NativeMessagingHosts/"
echo "#   Windows:       registry key under HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\$HOST_NAME"
