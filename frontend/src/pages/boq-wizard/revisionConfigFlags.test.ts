import { describe, it, expect } from "vitest";
import { computeDanglingRoles, hasDanglingDescription } from "./revisionConfigFlags";

const roleMap = {
  B: { role: "description", area: null },
  C: { role: "unit", area: null },
  E: { role: "rate_combined", area: null },
  F: { role: "amount_total", area: null },
};

describe("computeDanglingRoles", () => {
  it("flags a mapped column absent from the revised sheet (dangling role)", () => {
    // F is mapped but not present -> dangling.
    const d = computeDanglingRoles(roleMap, ["B", "C", "E"], true);
    expect([...d]).toEqual(["F"]);
  });

  it("returns empty when every mapped column is present", () => {
    expect(computeDanglingRoles(roleMap, ["B", "C", "E", "F"], true).size).toBe(0);
  });

  it("ignores an empty-role entry (a pending row)", () => {
    const rm = { ...roleMap, G: { role: "", area: null } };
    const d = computeDanglingRoles(rm, ["B", "C", "E", "F"], true);
    expect(d.size).toBe(0); // G has no role -> not dangling even though absent
  });

  it("never flags on a non-revision sheet (normal config flow untouched)", () => {
    expect(computeDanglingRoles(roleMap, ["B", "C", "E"], false).size).toBe(0);
  });

  it("never flags before the preview has loaded (no columns known)", () => {
    expect(computeDanglingRoles(roleMap, [], true).size).toBe(0);
  });
});

describe("hasDanglingDescription", () => {
  it("true when a dangling column carries the description role", () => {
    expect(hasDanglingDescription(new Set(["B"]), roleMap)).toBe(true);
  });

  it("false when the dangling columns are non-description", () => {
    expect(hasDanglingDescription(new Set(["F"]), roleMap)).toBe(false);
  });

  it("false when nothing is dangling", () => {
    expect(hasDanglingDescription(new Set(), roleMap)).toBe(false);
  });
});
