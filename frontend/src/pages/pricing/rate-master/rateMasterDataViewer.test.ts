// THE THIRD COERCION SITE -- what a human-typed attribute value is STORED as on a master item row.
//
// The other two are `rateMasterStructure.coerceForMatch` (value -> catalog match key) and the server
// `extraction._coerce_value` (model reply -> stored value). All three must agree: matching is strict
// identity, so an item row written with the string "1" where every other row carries the number 1
// can never be matched by anything.
//
// This site branched on `"number"` alone and so stored a `number_choice` as a STRING -- the same
// defect missed in the frontend, then on the server, and found here by the C1 sweep. It was LATENT
// (point_wiring is kind-less, so it owns no master rows to edit), which is exactly why it needed a
// pin rather than a live reproduction.

import { describe, it, expect } from "vitest";
import { coerceAttributeForStorage } from "./RateMasterDataViewer";
import type { AttributeDefinition } from "./rateMasterTypes";

const def = (type: string): Pick<AttributeDefinition, "type"> =>
  ({ type }) as Pick<AttributeDefinition, "type">;

describe("coerceAttributeForStorage -- number_choice (THE FIX)", () => {
  it("POSITIVE: a number_choice value is stored as a NUMBER", () => {
    expect(coerceAttributeForStorage(def("number_choice"), "1")).toBe(1);
    expect(typeof coerceAttributeForStorage(def("number_choice"), "1")).toBe("number");
  });

  it("POSITIVE: it keeps a fraction, and an integral form normalises like any number", () => {
    expect(coerceAttributeForStorage(def("number_choice"), "1.5")).toBe(1.5);
    expect(coerceAttributeForStorage(def("number_choice"), "1.0")).toBe(1);
  });

  it("THE DEFECT, pinned: it must NOT come back as a string", () => {
    // before the fix this returned the string "1", which no catalog row could ever match
    expect(coerceAttributeForStorage(def("number_choice"), "1")).not.toBe("1");
  });

  it("a blank stays blank -- the caller decides whether to skip it", () => {
    expect(coerceAttributeForStorage(def("number_choice"), "")).toBe("");
    expect(coerceAttributeForStorage(def("number_choice"), "   ")).toBe("   ");
  });

  it("NEGATIVE: a non-numeric entry is left VERBATIM, never NaN", () => {
    expect(coerceAttributeForStorage(def("number_choice"), "abc")).toBe("abc");
    expect(Number.isNaN(coerceAttributeForStorage(def("number_choice"), "abc") as number)).toBe(false);
  });
});

describe("coerceAttributeForStorage -- the existing types are UNCHANGED", () => {
  it("NEGATIVE: a choice value is still stored as a STRING", () => {
    expect(coerceAttributeForStorage(def("choice"), "PVC")).toBe("PVC");
    // a numeric-LOOKING choice value must stay a string -- its domain is strings
    expect(coerceAttributeForStorage(def("choice"), "1")).toBe("1");
    expect(typeof coerceAttributeForStorage(def("choice"), "1")).toBe("string");
  });

  it("a number value is stored numeric, exactly as before", () => {
    expect(coerceAttributeForStorage(def("number"), "25")).toBe(25);
    expect(coerceAttributeForStorage(def("number"), "1.5")).toBe(1.5);
  });

  it("a number with a blank entry stays blank, exactly as before", () => {
    expect(coerceAttributeForStorage(def("number"), "")).toBe("");
  });

  it("NEGATIVE: an unknown / future type falls through to STRING, never a number", () => {
    expect(coerceAttributeForStorage(def("some_future_type"), "1")).toBe("1");
    expect(typeof coerceAttributeForStorage(def("some_future_type"), "1")).toBe("string");
  });
});
