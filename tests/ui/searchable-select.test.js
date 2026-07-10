// Searchable-select component (lib/searchable-select.js).
// Progressively enhances a native <select>. Asserts the popup behaviour,
// keyboard navigation, the Add-new affordance, and that the underlying
// <select> stays the source of truth.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { attachSearchableSelect } from "../../lib/searchable-select.js";

function buildSelect() {
  document.body.innerHTML = `
    <div id="host">
      <select id="goal">
        <option value="Stop Churn">Stop Churn</option>
        <option value="Account Issue">Account Issue</option>
        <option value="Just Saying Thanks">Just Saying Thanks</option>
        <option value="Reactivate Churned User">Reactivate Churned User</option>
      </select>
    </div>`;
  return document.getElementById("goal");
}

describe("attachSearchableSelect", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders a trigger and hides the native select but keeps it accessible", () => {
    const sel = buildSelect();
    sel.value = "Account Issue";
    attachSearchableSelect(sel);

    const trigger = document.querySelector(".ss-trigger");
    expect(trigger).not.toBeNull();
    expect(trigger.querySelector(".ss-trigger-label").textContent).toBe("Account Issue");
    expect(sel.dataset.ssEnhanced).toBe("1");
    // Native select still in DOM with same value (forms keep working).
    expect(document.getElementById("goal").value).toBe("Account Issue");
  });

  it("opens popup on trigger click and lists all options", () => {
    const sel = buildSelect();
    attachSearchableSelect(sel);

    document.querySelector(".ss-trigger").click();
    const popup = document.querySelector(".ss-popup");
    expect(popup.hidden).toBe(false);
    const items = document.querySelectorAll(".ss-item");
    expect(items.length).toBe(4);
  });

  it("filters by typed query (substring, case-insensitive)", () => {
    const sel = buildSelect();
    attachSearchableSelect(sel);
    document.querySelector(".ss-trigger").click();
    const search = document.querySelector(".ss-search");
    search.value = "churn";
    search.dispatchEvent(new Event("input"));
    const labels = Array.from(document.querySelectorAll(".ss-item-label")).map((n) => n.textContent);
    expect(labels).toEqual(["Stop Churn", "Reactivate Churned User"]);
  });

  it("commits a pick to the underlying <select> and fires a change event", () => {
    const sel = buildSelect();
    const onChange = vi.fn();
    sel.addEventListener("change", onChange);
    attachSearchableSelect(sel);

    document.querySelector(".ss-trigger").click();
    const items = document.querySelectorAll(".ss-item");
    items[2].dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(sel.value).toBe("Just Saying Thanks");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".ss-trigger-label").textContent).toBe("Just Saying Thanks");
  });

  it("ArrowDown / Enter from the search box picks the first match", () => {
    const sel = buildSelect();
    attachSearchableSelect(sel);
    document.querySelector(".ss-trigger").click();
    const search = document.querySelector(".ss-search");
    search.value = "reactivate";
    search.dispatchEvent(new Event("input"));
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(sel.value).toBe("Reactivate Churned User");
  });

  it("shows 'Add \"foo\"' affordance when the query has no matches and onAddNew is provided", async () => {
    const sel = buildSelect();
    const onAddNew = vi.fn(async () => null);
    attachSearchableSelect(sel, { onAddNew });

    document.querySelector(".ss-trigger").click();
    const search = document.querySelector(".ss-search");
    search.value = "Cheeky";
    search.dispatchEvent(new Event("input"));

    const addBtn = document.querySelector(".ss-add");
    expect(addBtn).not.toBeNull();
    expect(addBtn.textContent).toContain("Cheeky");
    addBtn.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(onAddNew).toHaveBeenCalledWith("Cheeky");
  });

  it("does not enhance twice when called repeatedly", () => {
    const sel = buildSelect();
    attachSearchableSelect(sel);
    attachSearchableSelect(sel);
    expect(document.querySelectorAll(".ss-trigger").length).toBe(1);
  });

  it("Escape closes the popup", () => {
    const sel = buildSelect();
    attachSearchableSelect(sel);
    document.querySelector(".ss-trigger").click();
    expect(document.querySelector(".ss-popup").hidden).toBe(false);
    const search = document.querySelector(".ss-search");
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".ss-popup").hidden).toBe(true);
  });
});
