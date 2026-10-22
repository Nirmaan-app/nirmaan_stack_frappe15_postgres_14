import { describe, it, expect } from "vitest";
import * as EDIT from "./rateMasterEdit";
import {
  isRateMasterAdmin,
  parseFiniteInput,
} from "./rateMasterEdit";

describe("isRateMasterAdmin (RM-4a admin gate, owner option (a))", () => {
  it("admits Administrator and the Nirmaan Admin Profile", () => {
    expect(isRateMasterAdmin("Nirmaan Admin Profile", "Administrator")).toBe(true);
    expect(isRateMasterAdmin("Nirmaan Admin Profile", "someadmin@nirmaan.app")).toBe(true);
    expect(isRateMasterAdmin("anything", "Administrator")).toBe(true); // Administrator always
  });
  it("denies estimation + other roles (READ-ONLY surface)", () => {
    expect(isRateMasterAdmin("Nirmaan Estimates Executive Profile", "e@nirmaan.app")).toBe(false);
    expect(isRateMasterAdmin("Nirmaan Project Manager Profile", "pm@nirmaan.app")).toBe(false);
    expect(isRateMasterAdmin("", "x@nirmaan.app")).toBe(false);
  });
  it("denies while the role is still Loading (no read-only flash) and on Error", () => {
    expect(isRateMasterAdmin("Loading", "Administrator")).toBe(false);
    expect(isRateMasterAdmin("Error", "someone@nirmaan.app")).toBe(false);
  });
});

// ADP-5a (owner D9; ADP-R5 Q9): the `matchedConditionIndex` describe (3 its) and the `isEditableParam` it are removed
// with the two helpers -- the inline param edit they served went with its endpoint, `update_rate_config_param`.
describe("ADP-5a -- the inline param-edit helpers are gone; the shared ones stay", () => {
  it("NEGATIVE: matchedConditionIndex and isEditableParam are no longer exported", () => {
    for (const gone of ["matchedConditionIndex", "isEditableParam"]) {
      expect({ gone, exported: gone in EDIT }).toEqual({ gone, exported: false });
    }
  });
  it("POSITIVE: isRateMasterAdmin and parseFiniteInput (the item editors' helpers) are kept", () => {
    for (const kept of ["isRateMasterAdmin", "parseFiniteInput"]) {
      expect({ kept, exported: kept in EDIT }).toEqual({ kept, exported: true });
    }
  });
});

describe("parseFiniteInput (numeric-only, mirrors the server)", () => {
  it("parses finite input, rejects the rest", () => {
    expect(parseFiniteInput("0.70")).toBe(0.7);
    expect(parseFiniteInput("  -1 ")).toBe(-1);
    expect(parseFiniteInput("")).toBeNull();
    expect(parseFiniteInput("cheap")).toBeNull();
    expect(parseFiniteInput("Infinity")).toBeNull();
  });
});
