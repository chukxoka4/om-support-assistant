// Injected on demand via chrome.scripting.executeScript.
// Ports the original helper overlay: color-adaptive (dark/light), typewriter reveal,
// Summernote-aware replace. Idempotent.

(function () {
  if (window.__omShowSuggestion) return;

  function sanitize(html) {
    return (html || "")
      .replace(/^<html[^>]*>/i, "")
      .replace(/<\/html>$/i, "")
      .replace(/^<body[^>]*>/i, "")
      .replace(/<\/body>$/i, "")
      .replace(/^<div[^>]*>/i, "")
      .replace(/<\/div>$/i, "");
  }

  function getComputedColors(element = document.body) {
    const style = getComputedStyle(element);
    return {
      text: style.color || "#333",
      background: style.backgroundColor || "#fff"
    };
  }

  function isDark(bg) {
    const m = (bg || "").match(/\d+/g);
    if (!m || m.length < 3) return false;
    const [r, g, b] = m.map(Number);
    return (r * 299 + g * 587 + b * 114) / 1000 < 128;
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

  function ensureStyles() {
    if (document.getElementById("om-assistant-styles")) return;
    const s = document.createElement("style");
    s.id = "om-assistant-styles";
    s.textContent = `
      @keyframes om-blink { 50% { opacity: 0; } }
      .om-assistant-overlay * { box-sizing: border-box; }
      .om-assistant-overlay button:hover { filter: brightness(1.08); }
    `;
    document.head.appendChild(s);
  }

  window.__omShowSuggestion = function (newHtml, labelText) {
    removeExisting();
    ensureStyles();

    const colors = getComputedColors();
    const dark = isDark(colors.background);
    const boxBg = dark ? "#1f1f1f" : "#ffffff";
    const boxText = dark ? "#f1f1f1" : "#222222";
    const border = dark ? "#3a3a3a" : "#d9d9d9";
    const previewBg = dark ? "#161616" : "#fafafa";
    const cancelBg = dark ? "#2a2a2a" : "#f5f5f5";
    const cancelText = dark ? "#f1f1f1" : "#333333";

    const overlay = document.createElement("div");
    overlay.className = "om-assistant-overlay";
    Object.assign(overlay.style, {
      position: "fixed", top: "0", left: "0", width: "100%", height: "100%",
      background: "rgba(0,0,0,0.5)", display: "flex",
      alignItems: "center", justifyContent: "center", zIndex: "2147483647"
    });

    const box = document.createElement("div");
    Object.assign(box.style, {
      position: "relative", background: boxBg, color: boxText,
      padding: "16px", borderRadius: "8px",
      maxWidth: "760px", width: "90%", maxHeight: "80vh", overflowY: "auto",
      border: `1px solid ${border}`,
      boxShadow: "0 10px 40px rgba(0,0,0,0.35)",
      fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
    });

    const headerBar = document.createElement("div");
    Object.assign(headerBar.style, {
      display: "flex", justifyContent: "space-between", alignItems: "center",
      marginBottom: "12px", padding: "2px 4px 0"
    });

    const label = document.createElement("div");
    label.textContent = labelText || "OM Assistant";
    label.className = "om-status-label";
    Object.assign(label.style, { fontWeight: "600", fontSize: "14px" });

    const warn = document.createElement("div");
    warn.textContent = "⚠️";
    warn.title = "AI may provide incorrect answers. Review before using.";
    Object.assign(warn.style, {
      cursor: "help", fontSize: "18px", userSelect: "none",
      padding: "2px 4px", marginLeft: "8px"
    });

    headerBar.append(label, warn);
    box.appendChild(headerBar);

    document.__omUpdateStatus = (msg) => {
      const lbl = box.querySelector(".om-status-label");
      if (lbl && typeof msg === "string") lbl.textContent = msg;
    };

    const preview = document.createElement("div");
    Object.assign(preview.style, {
      whiteSpace: "normal", marginBottom: "14px",
      fontSize: "14px", lineHeight: "1.55", color: boxText,
      background: previewBg, border: `1px solid ${border}`,
      borderRadius: "6px", padding: "12px"
    });

    box.appendChild(preview);

    let i = 0;
    let buffer = "";
    const clean = sanitize(newHtml);
    function typeChar() {
      if (i < clean.length) {
        buffer += clean[i];
        preview.innerHTML = sanitize(buffer) + '<span style="font-weight:bold; animation: om-blink 1s step-start infinite;">|</span>';
        i++;
        setTimeout(typeChar, 8);
      } else {
        preview.innerHTML = clean;
      }
    }
    typeChar();

    const buttonBar = document.createElement("div");
    Object.assign(buttonBar.style, { textAlign: "right" });

    function mkBtn(text, bg, color) {
      const b = document.createElement("button");
      b.textContent = text;
      Object.assign(b.style, {
        marginLeft: "6px", background: bg, color,
        fontWeight: "600", border: "none", borderRadius: "4px",
        padding: "8px 16px", cursor: "pointer", fontSize: "14px",
        boxShadow: "0 2px 6px rgba(0,0,0,0.12)", transition: "filter .15s"
      });
      return b;
    }

    const replaceBtn = mkBtn("Replace Text", "#007bff", "#fff");
    const copyBtn = mkBtn("Copy to Clipboard", "#ff9800", "#fff");
    const cancelBtn = mkBtn("Cancel", cancelBg, cancelText);
    cancelBtn.style.border = `1px solid ${border}`;

    replaceBtn.addEventListener("click", () => {
      const ok = replaceSelectionWithHtml(clean);
      if (!ok) {
        replaceBtn.textContent = "No selection — copied";
        navigator.clipboard.writeText(preview.innerText || "").catch(() => {});
        setTimeout(() => overlay.remove(), 1100);
        return;
      }
      overlay.remove();
    });

    copyBtn.addEventListener("click", async () => {
      try {
        const htmlBlob = new Blob([clean], { type: "text/html" });
        const textBlob = new Blob([preview.innerText || ""], { type: "text/plain" });
        await navigator.clipboard.write([new ClipboardItem({ "text/html": htmlBlob, "text/plain": textBlob })]);
        copyBtn.textContent = "Copied!";
      } catch {
        await navigator.clipboard.writeText(preview.innerText || "");
        copyBtn.textContent = "Copied (plain)";
      }
      setTimeout(() => (copyBtn.textContent = "Copy to Clipboard"), 1200);
    });

    cancelBtn.addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

    buttonBar.append(replaceBtn, copyBtn, cancelBtn);
    box.appendChild(buttonBar);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  };

  window.__omGetSelectionHtml = function () {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return "";
    const div = document.createElement("div");
    div.appendChild(sel.getRangeAt(0).cloneContents());
    return div.innerHTML;
  };

  window.__omShowStatus = function (msg) {
    if (typeof document.__omUpdateStatus === "function") {
      document.__omUpdateStatus(msg);
      return;
    }
    let el = document.querySelector(".om-assistant-status");
    if (!el) {
      el = document.createElement("div");
      el.className = "om-assistant-status";
      const colors = getComputedColors();
      const dark = isDark(colors.background);
      Object.assign(el.style, {
        position: "fixed", bottom: "20px", right: "20px",
        background: dark ? "#f1f1f1" : "#111",
        color: dark ? "#111" : "#fff",
        padding: "10px 14px", borderRadius: "6px",
        fontFamily: "system-ui, sans-serif", fontSize: "13px",
        zIndex: "2147483647", boxShadow: "0 4px 12px rgba(0,0,0,0.25)"
      });
      document.body.appendChild(el);
    }
    el.textContent = msg;
    clearTimeout(el.__t);
    el.__t = setTimeout(() => el.remove(), 3000);
  };
})();
