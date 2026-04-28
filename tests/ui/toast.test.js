// Toast helper — A3: visible toast errors / success messages.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { showToast } from "../../lib/toast.js";

describe("showToast", () => {
  beforeEach(() => {
    document.body.innerHTML = `<div id="toasts"></div>`;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("appends a toast with success styling and ok role", () => {
    showToast("toasts", "Imported 24 entries");
    const toast = document.querySelector(".toast");
    expect(toast).not.toBeNull();
    expect(toast.classList.contains("toast--ok")).toBe(true);
    expect(toast.getAttribute("role")).toBe("status");
    expect(toast.textContent).toContain("Imported 24 entries");
  });

  it("uses error styling and alert role for kind=err", () => {
    showToast("toasts", "Import failed: missing scenario_instruction", "err");
    const toast = document.querySelector(".toast");
    expect(toast.classList.contains("toast--err")).toBe(true);
    expect(toast.getAttribute("role")).toBe("alert");
  });

  it("auto-dismisses after the default 4s window", () => {
    showToast("toasts", "x");
    expect(document.querySelectorAll(".toast")).toHaveLength(1);
    vi.advanceTimersByTime(4000);
    expect(document.querySelectorAll(".toast")).toHaveLength(0);
  });

  it("dismisses on click before timeout fires", () => {
    showToast("toasts", "x");
    document.querySelector(".toast").click();
    expect(document.querySelectorAll(".toast")).toHaveLength(0);
  });

  it("stacks multiple toasts in the container", () => {
    showToast("toasts", "first");
    showToast("toasts", "second", "err");
    expect(document.querySelectorAll(".toast")).toHaveLength(2);
  });

  it("returns null when the container is missing (no crash)", () => {
    expect(showToast("does-not-exist", "x")).toBeNull();
  });

  it("respects durationMs=0 to mean persistent", () => {
    showToast("toasts", "sticky", "ok", 0);
    vi.advanceTimersByTime(60_000);
    expect(document.querySelectorAll(".toast")).toHaveLength(1);
  });
});
