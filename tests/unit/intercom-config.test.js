// F2 — getIntercomConfig / setIntercomConfig in chrome.storage.sync.

import { describe, it, expect, beforeEach } from "vitest";
import { getIntercomConfig, setIntercomConfig } from "../../lib/storage.js";

describe("intercom config storage", () => {
  beforeEach(async () => {
    await chrome.storage.sync.clear();
  });

  it("defaults to { apiKey: '' } when nothing stored", async () => {
    expect(await getIntercomConfig()).toEqual({ apiKey: "" });
  });

  it("round-trips a key value", async () => {
    await setIntercomConfig({ apiKey: "tok_abc" });
    expect((await getIntercomConfig()).apiKey).toBe("tok_abc");
  });

  it("stores under intercom_config in sync storage (cross-device)", async () => {
    await setIntercomConfig({ apiKey: "tok_abc" });
    const { intercom_config } = await chrome.storage.sync.get("intercom_config");
    expect(intercom_config).toEqual({ apiKey: "tok_abc" });
  });

  it("setIntercomConfig(null) writes a safe empty default rather than removing", async () => {
    await setIntercomConfig({ apiKey: "tok_abc" });
    await setIntercomConfig(null);
    expect(await getIntercomConfig()).toEqual({ apiKey: "" });
  });
});
