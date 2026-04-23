// Injected on demand via chrome.scripting.executeScript to show the
// suggestion overlay for quick transforms. Exposes window.__omShowSuggestion.
// Idempotent — safe to inject multiple times per page.

(function () {
  if (window.__omShowSuggestion) return;

  function sanitize(html) {
    return (html || "")
      .replace(/^<html[^>]*>/i, "")
      .replace(/<\/html>$/i, "")
      .replace(/^<body[^>]*>/i, "")
      .replace(/<\/body>$/i, "");
  }

  function removeExisting() {
    document.querySelectorAll(".om-assistant-overlay").forEach((el) => el.remove());
  }

  function fireSummernoteEvents() {
    const editor = document.querySelector(".note-editable");
    if (!editor) return;
    ["input", "keydown", "keyup"].forEach((type) => {
      editor.dispatchEvent(new Event(type, { bubbles: true }));
    });
  }

  function replaceSelectionWithHtml(html) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return false;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const temp = document.createElement("div");
    temp.innerHTML = sanitize(html);
    const frag = document.createDocumentFragment();
    while (temp.firstChild) frag.appendChild(temp.firstChild);
    range.insertNode(frag);
    fireSummernoteEvents();
    return true;
  }

  function styleButton(btn, bg, color = "#fff") {
    Object.assign(btn.style, {
      background: bg,
      color,
      fontWeight: "600",
      border: "none",
      borderRadius: "4px",
      padding: "8px 16px",
      cursor: "pointer",
      fontSize: "14px",
      marginLeft: "6px"
    });
  }

  window.__omShowSuggestion = function (newHtml, label) {
    removeExisting();

    const overlay = document.createElement("div");
    overlay.className = "om-assistant-overlay";
    Object.assign(overlay.style, {
      position: "fixed", inset: "0", background: "rgba(0,0,0,0.5)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: "2147483647"
    });

    const box = document.createElement("div");
    Object.assign(box.style, {
      background: "#fff", color: "#222", padding: "16px",
      borderRadius: "8px", maxWidth: "720px", maxHeight: "80vh",
      width: "90%", overflowY: "auto",
      boxShadow: "0 10px 40px rgba(0,0,0,0.25)", fontFamily: "system-ui, sans-serif"
    });

    const header = document.createElement("div");
    Object.assign(header.style, {
      display: "flex", justifyContent: "space-between",
      alignItems: "center", marginBottom: "12px", fontWeight: "600", fontSize: "14px"
    });
    header.innerHTML = `<span>${label || "OM Assistant"}</span><span title="AI output — review before sending.">⚠️</span>`;

    const preview = document.createElement("div");
    Object.assign(preview.style, {
      border: "1px solid #e3e3e3", borderRadius: "6px",
      padding: "12px", marginBottom: "12px", fontSize: "14px", lineHeight: "1.5",
      background: "#fafafa"
    });
    preview.innerHTML = sanitize(newHtml);

    const buttons = document.createElement("div");
    buttons.style.textAlign = "right";

    const replaceBtn = document.createElement("button");
    replaceBtn.textContent = "Replace Selection";
    styleButton(replaceBtn, "#2563eb");

    const copyBtn = document.createElement("button");
    copyBtn.textContent = "Copy";
    styleButton(copyBtn, "#f59e0b");

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    styleButton(cancelBtn, "#f3f4f6", "#333");

    replaceBtn.addEventListener("click", () => {
      const ok = replaceSelectionWithHtml(newHtml);
      if (!ok) {
        replaceBtn.textContent = "No selection — copied instead";
        navigator.clipboard.writeText(preview.innerText || "").catch(() => {});
        setTimeout(() => overlay.remove(), 1200);
        return;
      }
      overlay.remove();
    });

    copyBtn.addEventListener("click", async () => {
      try {
        const htmlBlob = new Blob([sanitize(newHtml)], { type: "text/html" });
        const textBlob = new Blob([preview.innerText || ""], { type: "text/plain" });
        await navigator.clipboard.write([new ClipboardItem({ "text/html": htmlBlob, "text/plain": textBlob })]);
        copyBtn.textContent = "Copied";
      } catch {
        await navigator.clipboard.writeText(preview.innerText || "");
        copyBtn.textContent = "Copied (plain)";
      }
      setTimeout(() => (copyBtn.textContent = "Copy"), 1200);
    });

    cancelBtn.addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

    buttons.append(replaceBtn, copyBtn, cancelBtn);
    box.append(header, preview, buttons);
    overlay.append(box);
    document.body.append(overlay);
  };

  window.__omGetSelectionHtml = function () {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return "";
    const range = sel.getRangeAt(0);
    const div = document.createElement("div");
    div.appendChild(range.cloneContents());
    return div.innerHTML;
  };

  window.__omShowStatus = function (msg) {
    let el = document.querySelector(".om-assistant-status");
    if (!el) {
      el = document.createElement("div");
      el.className = "om-assistant-status";
      Object.assign(el.style, {
        position: "fixed", bottom: "20px", right: "20px",
        background: "#111", color: "#fff", padding: "10px 14px",
        borderRadius: "6px", fontFamily: "system-ui, sans-serif",
        fontSize: "13px", zIndex: "2147483647",
        boxShadow: "0 4px 12px rgba(0,0,0,0.25)"
      });
      document.body.appendChild(el);
    }
    el.textContent = msg;
    clearTimeout(el.__t);
    el.__t = setTimeout(() => el.remove(), 3000);
  };
})();
