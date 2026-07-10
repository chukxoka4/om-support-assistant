// getReportConfig / setReportConfig — chrome.storage.sync round-trip.

import { describe, it, expect, beforeEach } from "vitest";
import { getReportConfig, setReportConfig } from "../../lib/storage.js";

describe("report config storage", () => {
  beforeEach(async () => {
    await chrome.storage.sync.clear();
  });

  it("defaults to empty agentName when nothing stored", async () => {
    expect(await getReportConfig()).toEqual({ agentName: "" });
  });

  it("round-trips an author name", async () => {
    await setReportConfig({ agentName: "Nwachukwu Okafor" });
    expect((await getReportConfig()).agentName).toBe("Nwachukwu Okafor");
  });

  it("stored under report_config in chrome.storage.sync (cross-device)", async () => {
    await setReportConfig({ agentName: "Erica Franz" });
    const { report_config } = await chrome.storage.sync.get("report_config");
    expect(report_config).toEqual({ agentName: "Erica Franz" });
  });

  it("setReportConfig(null) writes a safe empty default", async () => {
    await setReportConfig({ agentName: "x" });
    await setReportConfig(null);
    expect(await getReportConfig()).toEqual({ agentName: "" });
  });
});
