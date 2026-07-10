#!/usr/bin/env bash
# Thin shim → the real installer is the cross-platform bridge/install.js.
# Kept so `bash bridge/install.sh <EXT_ID>` still works. On Windows, run
# `node bridge\install.js <EXT_ID>` directly.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE="$(command -v node || true)"
if [[ -z "$NODE" ]]; then
  echo "ERROR: 'node' not found on PATH. Install Node (any recent LTS) and re-run." >&2
  exit 1
fi
exec "$NODE" "$HERE/install.js" "$@"
