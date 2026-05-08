// Lightweight searchable-select component. Progressively enhances a native
// <select>: keeps the select as the source of truth (form serialization,
// programmatic value sets, change events all keep working), but renders a
// custom trigger + popup that lets the user filter long option lists by
// typing.
//
// Pure DOM module — no chrome.*, no project-specific imports. Reused for
// goal / audience / tone / mode / libraryPick.
//
// Usage:
//   attachSearchableSelect(selectEl, {
//     maxVisibleRows: 8,
//     onAddNew: async (typed) => "<value>" | null   // optional
//   });
// The onAddNew callback fires when the user clicks "Add 'foo'" with a
// search query that didn't match. Return the value to insert (or null to
// abort). The component itself does NOT mutate the underlying option list
// — caller is responsible for repopulating the <select> and re-attaching
// (or simpler: handle the add elsewhere and trigger a re-render).

const ARIA_OPEN = "aria-expanded";

function createEl(tag, className, attrs = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === "text") node.textContent = v;
    else node.setAttribute(k, v);
  }
  return node;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function attachSearchableSelect(select, opts = {}) {
  if (!select || select.dataset.ssEnhanced === "1") return null;
  const maxVisibleRows = opts.maxVisibleRows ?? 8;
  const onAddNew = typeof opts.onAddNew === "function" ? opts.onAddNew : null;

  select.dataset.ssEnhanced = "1";
  // Hide visually but keep accessible to forms / scripts.
  select.style.position = "absolute";
  select.style.opacity = "0";
  select.style.pointerEvents = "none";
  select.style.width = "1px";
  select.style.height = "1px";
  select.style.overflow = "hidden";
  select.tabIndex = -1;

  const wrap = createEl("div", "ss-wrap");
  wrap.style.position = "relative";
  select.parentNode.insertBefore(wrap, select);
  wrap.appendChild(select);

  const trigger = createEl("button", "ss-trigger", { type: "button", "aria-haspopup": "listbox" });
  trigger.setAttribute(ARIA_OPEN, "false");
  const triggerLabel = createEl("span", "ss-trigger-label");
  const triggerCaret = createEl("span", "ss-trigger-caret", { "aria-hidden": "true", text: "▾" });
  trigger.appendChild(triggerLabel);
  trigger.appendChild(triggerCaret);
  wrap.appendChild(trigger);

  const popup = createEl("div", "ss-popup", { role: "dialog" });
  popup.hidden = true;
  const search = createEl("input", "ss-search", { type: "text", role: "combobox", "aria-autocomplete": "list", placeholder: "Search…" });
  const list = createEl("ul", "ss-list", { role: "listbox" });
  list.style.maxHeight = `${maxVisibleRows * 32}px`;
  const empty = createEl("div", "ss-empty");
  empty.hidden = true;
  popup.appendChild(search);
  popup.appendChild(list);
  popup.appendChild(empty);
  wrap.appendChild(popup);

  // Internal state
  let activeIndex = -1;
  let filteredOptions = [];

  function syncTriggerLabel() {
    const opt = select.options[select.selectedIndex];
    triggerLabel.textContent = opt ? opt.textContent : "—";
    triggerLabel.setAttribute("title", opt?.textContent || "");
  }

  function readOptions() {
    return Array.from(select.options).map((o) => ({
      value: o.value,
      label: o.textContent || "",
      disabled: o.disabled
    }));
  }

  function renderList(query) {
    const raw = String(query || "").trim();
    const q = raw.toLowerCase();
    const all = readOptions();
    filteredOptions = q
      ? all.filter((o) => o.label.toLowerCase().includes(q))
      : all;
    list.innerHTML = "";
    activeIndex = -1;
    if (!filteredOptions.length) {
      list.hidden = true;
      empty.hidden = false;
      empty.innerHTML = "";
      const msg = createEl("div", "ss-empty-msg", { text: q ? "No matches." : "Nothing here yet." });
      empty.appendChild(msg);
      if (onAddNew && raw) {
        const add = createEl("button", "ss-add", { type: "button" });
        add.textContent = `Add "${raw}"`;
        add.addEventListener("click", async (e) => {
          e.preventDefault();
          const v = await onAddNew(raw);
          if (!v) return;
          // After the caller updates the underlying <select>, re-render so
          // the new value is selectable. Caller is responsible for setting
          // select.value if they want it pre-selected.
          syncTriggerLabel();
          renderList("");
          search.value = "";
          search.focus();
        });
        empty.appendChild(add);
      }
      return;
    }
    list.hidden = false;
    empty.hidden = true;
    filteredOptions.forEach((opt, i) => {
      const li = createEl("li", "ss-item", { role: "option", "data-value": opt.value });
      li.title = opt.label; // full text on hover for long labels
      li.innerHTML = `<span class="ss-item-label">${escapeHtml(opt.label)}</span>`;
      if (opt.value === select.value) li.classList.add("is-selected");
      li.addEventListener("mousedown", (e) => {
        e.preventDefault(); // keep search focused; we'll close after pick
        pick(i);
      });
      list.appendChild(li);
    });
  }

  function setActive(idx) {
    const items = list.querySelectorAll(".ss-item");
    items.forEach((it, i) => it.classList.toggle("is-active", i === idx));
    activeIndex = idx;
    if (idx >= 0 && items[idx]) {
      items[idx].scrollIntoView({ block: "nearest" });
    }
  }

  function pick(idx) {
    const opt = filteredOptions[idx];
    if (!opt || opt.disabled) return;
    select.value = opt.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    syncTriggerLabel();
    close();
  }

  function open() {
    if (!popup.hidden) return;
    popup.hidden = false;
    trigger.setAttribute(ARIA_OPEN, "true");
    search.value = "";
    renderList("");
    setTimeout(() => search.focus(), 0);
  }

  function close() {
    if (popup.hidden) return;
    popup.hidden = true;
    trigger.setAttribute(ARIA_OPEN, "false");
  }

  function toggle() {
    popup.hidden ? open() : close();
  }

  // Event wiring
  trigger.addEventListener("click", (e) => {
    e.preventDefault();
    toggle();
  });
  trigger.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
      e.preventDefault();
      open();
    }
  });

  search.addEventListener("input", () => renderList(search.value));
  search.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); close(); trigger.focus(); return; }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(Math.min(filteredOptions.length - 1, activeIndex + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(Math.max(0, activeIndex - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0) pick(activeIndex);
      else if (filteredOptions.length) pick(0);
    }
  });

  // Outside-click close
  document.addEventListener("mousedown", (e) => {
    if (popup.hidden) return;
    if (wrap.contains(e.target)) return;
    close();
  });

  // Native API hooks: re-sync when the underlying select is changed by code
  // (e.g. setDropdowns).
  const observer = new MutationObserver(() => syncTriggerLabel());
  observer.observe(select, { attributes: true, childList: true, subtree: true, attributeFilter: ["value"] });

  // Programmatic value sets (select.value = "foo") don't fire change events,
  // so consumers should dispatch one or call refresh().
  function refresh() {
    syncTriggerLabel();
    if (!popup.hidden) renderList(search.value);
  }

  syncTriggerLabel();

  return { open, close, refresh };
}
