import { describe, it, expect } from "vitest";
import * as EDIT from "./rateMasterEdit";
import {
  parseFiniteInput,
} from "./rateMasterEdit";

// ADP-5a (owner D9; ADP-R5 Q9): the `matchedConditionIndex` describe (3 its) and the `isEditableParam` it are removed
// with the two helpers -- the inline param edit they served went with its endpoint, `update_rate_config_param`.
describe("ADP-5a -- the inline param-edit helpers are gone; the shared ones stay", () => {
  it("NEGATIVE: matchedConditionIndex and isEditableParam are no longer exported", () => {
    for (const gone of ["matchedConditionIndex", "isEditableParam"]) {
      expect({ gone, exported: gone in EDIT }).toEqual({ gone, exported: false });
    }
  });
  it("POSITIVE: parseFiniteInput (the item editors' helper) is kept", () => {
    for (const kept of ["parseFiniteInput"]) {
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
