// Toast helper. Lives at the repository layer alongside lib/html.js — pure DOM,
// no business logic. Both Options and the side-panel surface call it so the
// presentation stays identical.

const DEFAULT_DURATION_MS = 4000;

export function showToast(containerId, text, kind = "ok", durationMs = DEFAULT_DURATION_MS) {
  const container = document.getElementById(containerId);
  if (!container) return null;
  const node = document.createElement("div");
  node.className = `toast toast--${kind}`;
  node.setAttribute("role", kind === "err" ? "alert" : "status");
  node.textContent = text;
  const close = document.createElement("span");
  close.className = "toast__close";
  close.textContent = "×";
  node.appendChild(close);

  const dismiss = () => {
    if (node.parentNode) node.parentNode.removeChild(node);
  };
  node.addEventListener("click", dismiss);
  if (durationMs > 0) setTimeout(dismiss, durationMs);

  container.appendChild(node);
  return node;
}
