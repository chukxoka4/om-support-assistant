// Pure: turn a raw provider error into an actionable one when it's a Claude Code
// bridge failure, so the side panel can point the user at the fix instead of
// showing a bare "native host has exited". Non-bridge errors pass through
// unchanged. No DOM, no storage — just string classification.

const BRIDGE_ERROR_RE =
  /claude-code bridge|native messaging host|native host has exited|not logged in|bridge not installed/i;

const FIX = 'open Options → "Test connection", or reinstall the bridge (see bridge/README.md)';

export function bridgeErrorHint(error) {
  const e = String(error || "");
  if (!e) return e;
  if (e.includes(FIX)) return e; // already enriched
  if (BRIDGE_ERROR_RE.test(e)) return `${e} — Fix: ${FIX}.`;
  return e;
}
