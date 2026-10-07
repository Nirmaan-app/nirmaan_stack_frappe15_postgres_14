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
import {
  gridColumnKeys, COL_SOURCE_SHEET, COL_SOURCE_ROW, COL_FORMULA_SUPPLY, COL_FORMULA_INSTALL,
} from "./rateMasterGridColumns";
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

  // ⚠️ INVERTED 2026-10-07 (slice 12d-2F, owner F1) under mechanical authority, NOT deleted. The cell's
  // figure is now `shown` = `displayedRateValue(r.it, k, computed, computedRates)` -- a COMPUTED cell reads
  // the server's display map, every other cell the stored rate -- so the old `r.it.rates[k]` read in this
  // expression is asserted ABSENT. The CLAIM is unchanged: a value cell renders through pricingInputCell.
  it("ACCEPTANCE 6: a value cell renders through pricingInputCell, so it reads as a percentage", () => {
    expect(src).toContain("piMode ? pricingInputCell(k, shown) : shown");
    expect(src).toContain("const shown = displayedRateValue(r.it, k, computed, computedRates);");
    expect(src).not.toContain("piMode ? pricingInputCell(k, r.it.rates[k]) : r.it.rates[k]");   // the pre-12d-2F read
  });

  // ⚠️ INVERTED 2026-10-05 under mechanical authority, NOT deleted. It pinned the ABSENCE of the SKU
  // columns in Pricing Inputs by grepping for the `{!piMode && ...}` JSX that placed them. Those
  // inline placements are gone: the header, the formula row and the body now all map ONE shared
  // column list (`rateMasterGridColumns.gridColumnKeys`), because keeping the order in three places
  // is what let the `unit` column drift out of step with its heading on every non-PI grid.
  // The CLAIM is unchanged and is now asserted against the list itself -- behaviour, not source text.
  it("ACCEPTANCE 4: the SKU columns are ABSENT for a Pricing Input", () => {
    const base = { canEdit: false, showKindCol: false, specMode: false, showImpactCol: false,
                   textCols: [], attrCols: [{ id: "a" }], rateCols: ["r1"] };
    const pi = gridColumnKeys({ ...base, piMode: true });
    // source sheet / row and the two formula columns are what "nothing borrowed from a SKU file" means
    for (const k of [COL_SOURCE_SHEET, COL_SOURCE_ROW, COL_FORMULA_SUPPLY, COL_FORMULA_INSTALL]) {
      expect(pi).not.toContain(k);
    }
    // NEGATIVE HALF KEPT: a SKU grid still carries all four
    const sku = gridColumnKeys({ ...base, piMode: false });
    for (const k of [COL_SOURCE_SHEET, COL_SOURCE_ROW, COL_FORMULA_SUPPLY, COL_FORMULA_INSTALL]) {
      expect(sku).toContain(k);
    }
    // and the retired inline placements must not come back
    expect(src).not.toContain("{!piMode && <TableCell>{r.it.source_sheet}</TableCell>}");
  });

  // ⚠️ INVERTED at slice 12b(B), not deleted. This pin used to assert that `remarks` was its OWN
  // column. Acceptance item 6 moved it UNDER the input's name (the owner: "the column widths are all
  // wrong which make reading them very difficult" -- a 255-character remark was taking the width the
  // eight percentage columns needed). The pin now asserts the NEW truth AND that the old column is
  // gone, so a revert to a remarks column fails here rather than passing quietly.
  it("ACCEPTANCE 4 + 12 + 6: the name leads the row and CARRIES the remark; sharing and used-by are their own columns", () => {
    expect(src).toContain('hdr("pi:name", "input")');
    expect(src).toContain('hdr("pi:shared_by", "shared by")');
    expect(src).toContain('hdr("pi:used_by", "used by")');
    // the remark is NO LONGER a column of its own ...
    expect(src).not.toContain('hdr("pi:remarks"');
    // ... and it is rendered inside the name cell instead
    // the cell now carries its column key, so the slice starts at the keyed open tag
    const nameCell = src.slice(src.indexOf('<TableCell key={COL_PI_NAME} className="font-medium align-top">'));
    const upToClose = nameCell.slice(0, nameCell.indexOf("</TableCell>"));
    expect(upToClose).toContain("r.it.attributes?.name");
    expect(upToClose).toContain("r.it.attributes?.remarks");
  });

  // ─── SLICE 12b(B) ────────────────────────────────────────────────────────────────────────────
  it("ACCEPTANCE 6: the Pricing Inputs grid declares a COLUMN PLAN; another category's grid does not", () => {
    // `table-fixed` + a colgroup, both gated on piMode -- a SKU grid keeps its auto layout
    expect(src).toContain('cn(piMode && "table-fixed")');
    expect(src).toContain("{piMode ? (\n            <colgroup>");
    /**
     * ⚠️ INVERTED (owner, 2026-09-29). The plan used to size `amount` wider than a percentage and let
     * the `input` column take the slack; the slack column is what re-flowed the whole grid when the
     * impact panel opened. Every width is now a named constant in ONE plan, and the table declares
     * its own total so a narrower container scrolls instead of squeezing.
     */
    expect(src).not.toContain('style={{ width: k === "amount" ? 92 : 84 }}');
    expect(src).toContain("style={{ width: PI_W.rate }}");
    expect(src).toContain("style={{ width: PI_W.input }}");
    expect(src).toContain("minWidth: piTableWidth");
    expect(src).not.toContain("<col />{/* input name");
  });

  it("ACCEPTANCE 1: a rate header carries its DERIVED kind -- and a Pricing Input does NOT", () => {
    // the label rides as `note`, never as `tag` (whose uppercase styling is the spec-mode marker)
    expect(src).toContain("piMode ? undefined : rateLabelFor(k)");
    expect(src).toContain("deriveRateColumnLabels(");
  });

  it("NEGATIVE: the label is gated on the DISCIPLINE, so an HVAC config gets none", () => {
    // the viewer passes the config's own discipline; the deriver refuses anything outside its register
    expect(src).toMatch(/deriveRateColumnLabels\([\s\S]{0,200}?discipline/);
  });

  it("a Pricing Input's own TEXT is searchable (it was not before 12b(B))", () => {
    // its config declares no attribute_definitions, so attrCols is empty and the haystack held only
    // rates + unit -- typing an input's NAME matched nothing
    const rowsMemo = src.slice(src.indexOf("const rows = useMemo"));
    const upTo = rowsMemo.slice(0, rowsMemo.indexOf("const filtered"));
    expect(upTo).toContain("cellText(it.attributes?.name)");
    expect(upTo).toContain("cellText(it.attributes?.remarks)");
    expect(upTo).toContain("cellText(it.attributes?.used_by)");
  });

  /**
   * ⚠️ INVERTED BY SLICE 12c, claim unchanged. It asserted the cell renders `r.it.attributes?.used_by`
   * DIRECTLY; it now renders `usedByText(r.it)`, which returns that stored value when there is one and
   * the DERIVED text when there is not. HVAC's inputs carry no stored copy -- deliberately, because a
   * stored count goes stale the moment a pipeline changes -- so the column read EMPTY for all seven
   * while they priced 204 rows, which the live page showed and no test did. The READ-ONLY claim, which
   * is what acceptance 13 is about, is unchanged and still asserted.
   */
  it("ACCEPTANCE 13: the used-by cell is READ-ONLY -- rendered, never an input", () => {
    const cell = src.slice(src.indexOf('data-testid="pi-used-by"'));
    const upToClose = cell.slice(0, cell.indexOf("</TableCell>"));
    expect(upToClose).toContain("usedByText(r.it)");
    expect(upToClose).not.toContain("<Input");
    expect(upToClose).not.toContain("onChange");
    // and the resolver really is stored-first, so a stored value is never replaced by a derived one
    const fn = src.slice(src.indexOf("const usedByText = useCallback"));
    const body = fn.slice(0, fn.indexOf("}, [derivedUsedBy]);"));
    expect(body).toContain("it.attributes?.used_by");
    expect(body.indexOf("return String(stored)")).toBeLessThan(body.indexOf("pricingInputUsedByText"));
  });

  /**
   * ⚠️ INVERTED (owner, 2026-09-29). The header now shows the SHORT label with the full name on the
   * hover: at 72px "Installation markup" printed over its neighbour, and shortening the words was
   * the only thing that fixed it -- wrapping alone did not. The claim is unchanged in substance --
   * no column reads as a bare key -- so the pin asserts the new spelling and the hover.
   */
  it("the column headers use the owner's labels (short on screen, full on hover)", () => {
    expect(src).not.toContain("piMode ? (PRICING_INPUT_COLUMN_LABELS[k] ?? k) : k");
    expect(src).toContain("PRICING_INPUT_COLUMN_SHORT_LABELS[k] ?? PRICING_INPUT_COLUMN_LABELS[k] ?? k");
    // the full name is still reachable, as the hover on the label and on the filter
    expect(src).toContain("fullLabelFor(colKey, label)");
  });

  /**
   * The three causes of the overlap the owner photographed, each pinned so none can come back alone:
   * the label may not exceed its column, the filter may not take width from it, and the cell clips.
   */
  it("a pricing-input header cannot overlap its neighbour", () => {
    expect(src).toContain("min-w-0");            // the label shrinks instead of overflowing
    expect(src).toContain("line-clamp-2");       // at most two lines
    expect(src).toContain("break-normal");       // never mid-word
    expect(src).toContain("absolute right-0 top-0 shrink-0");  // the filter is out of the flow
    expect(src).toContain("overflow-hidden");    // and the cell clips whatever is left
  });

  it("NEGATIVE: the mode is decided by the CONFIG's kind, never by a discipline name in code", () => {
    expect(src).toContain("isPricingInputConfig(config)");
    // no discipline is named anywhere in the pricing-input wiring
    expect(src).not.toMatch(/piMode[^\n]*"Electrical"/);
    expect(src).not.toContain('"electrical_pricing_inputs"');
  });
});
