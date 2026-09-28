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
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

// =====================================================================================
// SLICE 12b(A) -- PRICING INPUTS on the screen. SOURCE pins, in the rateMasterFreeze /
// pricingCalculator idiom: the component is a 1,300-line DOM tree, so what is pinned here is that
// each acceptance item is WIRED, not how it looks. The arithmetic and the wording are pinned in
// rateMasterSpec.test.ts against the pure helpers.
// =====================================================================================
describe("SLICE 12b(A) -- the viewer wires the Pricing Inputs columns", () => {
  const src = readFileSync(join(__dirname, "RateMasterDataViewer.tsx"), "utf8");

  it("ACCEPTANCE 6: a value cell renders through pricingInputCell, so it reads as a percentage", () => {
    expect(src).toContain("piMode ? pricingInputCell(k, r.it.rates[k]) : r.it.rates[k]");
  });

  it("ACCEPTANCE 4: the SKU columns are ABSENT for a Pricing Input", () => {
    // source sheet / row and the two formula columns are what "nothing borrowed from a SKU file" means
    expect(src).toContain("{!piMode && <TableCell>{r.it.source_sheet}</TableCell>}");
    expect(src).toContain("{!piMode && FORMULA_COLUMNS.map(");
  });

  it("ACCEPTANCE 4 + 12: the name leads the row; sharing, remarks and used-by are their own columns", () => {
    expect(src).toContain('hdr("pi:name", "input")');
    expect(src).toContain('hdr("pi:shared_by", "shared by")');
    expect(src).toContain('hdr("pi:remarks", "remarks")');
    expect(src).toContain('hdr("pi:used_by", "used by")');
  });

  it("ACCEPTANCE 13: the used-by cell is READ-ONLY -- rendered, never an input", () => {
    const cell = src.slice(src.indexOf('data-testid="pi-used-by"'));
    const upToClose = cell.slice(0, cell.indexOf("</TableCell>"));
    expect(upToClose).toContain("r.it.attributes?.used_by");
    expect(upToClose).not.toContain("<Input");
    expect(upToClose).not.toContain("onChange");
  });

  it("the column headers use the owner's labels, so no column reads as a bare key", () => {
    expect(src).toContain("piMode ? (PRICING_INPUT_COLUMN_LABELS[k] ?? k) : k");
  });

  it("NEGATIVE: the mode is decided by the CONFIG's kind, never by a discipline name in code", () => {
    expect(src).toContain("isPricingInputConfig(config)");
    // no discipline is named anywhere in the pricing-input wiring
    expect(src).not.toMatch(/piMode[^\n]*"Electrical"/);
    expect(src).not.toContain('"electrical_pricing_inputs"');
  });
});
