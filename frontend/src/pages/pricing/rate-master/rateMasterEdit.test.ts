import { describe, it, expect } from "vitest";
import {
  isRateMasterAdmin,
  matchedConditionIndex,
  isEditableParam,
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

describe("matchedConditionIndex (re-derives the interpreter's matched branch)", () => {
  const step = {
    conditions: [
      { when: { insulation: "ARMOURED" }, params: { discount: 0.75, markup: 0.35 } },
      { when: { insulation: "UNARMOURED" }, params: { discount: 0.57, markup: 0.4 } },
    ],
  };
  it("returns the ARMOURED branch index (0) for an armoured matched item", () => {
    expect(matchedConditionIndex(step, { insulation: "ARMOURED", material: "COPPER" })).toBe(0);
  });
  it("returns the UNARMOURED branch index (1)", () => {
    expect(matchedConditionIndex(step, { insulation: "UNARMOURED" })).toBe(1);
  });
  it("null for a plain step (no conditions) or no match / missing attrs", () => {
    expect(matchedConditionIndex({ conditions: [] }, { insulation: "ARMOURED" })).toBeNull();
    expect(matchedConditionIndex(undefined, { insulation: "ARMOURED" })).toBeNull();
    expect(matchedConditionIndex(step, { insulation: "MYSTERY" })).toBeNull();
    expect(matchedConditionIndex(step, null)).toBeNull();
  });
});

describe("isEditableParam / parseFiniteInput (numeric-only, mirrors the server)", () => {
  it("only finite numbers are editable", () => {
    expect(isEditableParam(0.75)).toBe(true);
    expect(isEditableParam(-1)).toBe(true);
    expect(isEditableParam("cable")).toBe(false); // string param (kind) stays read-only
    expect(isEditableParam(Infinity)).toBe(false);
    expect(isEditableParam(null)).toBe(false);
  });
  it("parses finite input, rejects the rest", () => {
    expect(parseFiniteInput("0.70")).toBe(0.7);
    expect(parseFiniteInput("  -1 ")).toBe(-1);
    expect(parseFiniteInput("")).toBeNull();
    expect(parseFiniteInput("cheap")).toBeNull();
    expect(parseFiniteInput("Infinity")).toBeNull();
  });
});
