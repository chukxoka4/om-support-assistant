// Pure prompt generator for the WPSA AI ticketing reporter.

import { describe, it, expect } from "vitest";
import { buildWpsaPrompt, previousMondayToSunday } from "../../lib/prompt-generator.js";

const baseArgs = { scope: "personal", weekStart: "2026-04-19", weekEnd: "2026-04-25", agent: "Nwachukwu Okafor" };

describe("buildWpsaPrompt — input validation", () => {
  it("throws when scope is invalid", () => {
    expect(() => buildWpsaPrompt({ ...baseArgs, scope: "department" })).toThrow(/scope must be/);
  });

  it("throws on bad date strings", () => {
    expect(() => buildWpsaPrompt({ ...baseArgs, weekStart: "Apr 19" })).toThrow(/weekStart must be/);
    expect(() => buildWpsaPrompt({ ...baseArgs, weekEnd: "" })).toThrow(/weekEnd must be/);
  });
});

describe("buildWpsaPrompt — personal scope", () => {
  it("bakes in the supplied agent and dates", () => {
    const out = buildWpsaPrompt(baseArgs);
    expect(out).toContain("Date Range: 2026-04-19 to 2026-04-25");
    expect(out).toContain("Scope: personal");
    expect(out).toContain("Agent label: Nwachukwu Okafor");
    expect(out).toContain('"weekStart": "2026-04-19"');
    expect(out).toContain('"weekEnd": "2026-04-25"');
    expect(out).toContain('"agent": "Nwachukwu Okafor"');
    expect(out).toContain('"scope": "personal"');
    expect(out).toContain("for Nwachukwu Okafor");
  });

  it("falls back to 'You' when agent is empty/whitespace", () => {
    const out = buildWpsaPrompt({ ...baseArgs, agent: "   " });
    expect(out).toContain('"agent": "You"');
    expect(out).toContain("Agent label: You");
  });

  it("preserves teammate names verbatim", () => {
    const out = buildWpsaPrompt({ ...baseArgs, agent: "Erica Franz" });
    expect(out).toContain("Agent label: Erica Franz");
    expect(out).toContain('"agent": "Erica Franz"');
  });
});

describe("buildWpsaPrompt — team scope", () => {
  it("forces agent to 'Team' regardless of input", () => {
    const out = buildWpsaPrompt({ ...baseArgs, scope: "team", agent: "Nwachukwu Okafor" });
    expect(out).toContain("Agent label: Team");
    expect(out).toContain('"agent": "Team"');
    expect(out).toContain('"scope": "team"');
    expect(out).toContain("across the WHOLE TEAM");
    expect(out).not.toContain("for Nwachukwu Okafor");
  });
});

describe("buildWpsaPrompt — schema body", () => {
  it("includes the three new oiVerdict enums and rule lines", () => {
    const out = buildWpsaPrompt(baseArgs);
    expect(out).toContain("primaryGrowthLever");
    expect(out).toContain("churn|reactivations|upgrades|cost_reduction|none");
    expect(out).toContain("mveBootstrap");
    expect(out).toContain("escalationVerdict");
    expect(out).toContain("playbook_only|escalate|watch");
  });

  it("explicitly allows cost_reduction / none in the rules block", () => {
    const out = buildWpsaPrompt(baseArgs);
    expect(out).toContain('"cost_reduction"');
    expect(out).toContain('"none"');
  });

  it("rules include the bootstrap-first MVE question", () => {
    const out = buildWpsaPrompt(baseArgs);
    expect(out).toMatch(/saved-reply/i);
    expect(out).toMatch(/Playbook entry/i);
  });
});

describe("buildWpsaPrompt — determinism", () => {
  it("same inputs produce byte-identical output", () => {
    const a = buildWpsaPrompt(baseArgs);
    const b = buildWpsaPrompt({ ...baseArgs });
    expect(a).toBe(b);
  });
});

describe("previousMondayToSunday", () => {
  it("returns Mon→Sun ISO range relative to a given date", () => {
    // Tuesday 2026-04-28 → previous Mon 2026-04-20, previous Sun 2026-04-26.
    const tue = new Date(2026, 3, 28);
    expect(previousMondayToSunday(tue)).toEqual({
      weekStart: "2026-04-20",
      weekEnd: "2026-04-26"
    });
  });

  it("when run on a Sunday, returns the most recent completed Mon→Sun (not the same-day Sunday)", () => {
    // Sunday 2026-04-26 → previous Mon 2026-04-13, previous Sun 2026-04-19.
    const sun = new Date(2026, 3, 26);
    const r = previousMondayToSunday(sun);
    expect(r.weekStart).toBe("2026-04-13");
    expect(r.weekEnd).toBe("2026-04-19");
  });

  it("on a Monday, returns the previous full Mon→Sun", () => {
    // Monday 2026-04-27 → previous Mon 2026-04-20, previous Sun 2026-04-26.
    const mon = new Date(2026, 3, 27);
    expect(previousMondayToSunday(mon)).toEqual({
      weekStart: "2026-04-20",
      weekEnd: "2026-04-26"
    });
  });
});
