// Unit tests for the template-flow quantity gate (A2 negative rule + at-least-one-area).
//
// isLineItemQtyGap mirrors the backend `_template_line_item_qty_gap` (review_screen.py) --
// the two must agree (ADR-0010 F1 FE<->BE parity). "gap" = the row would BLOCK finalize:
// missing/zero total (all areas empty for multi-area, since qty_total = sum(areas)), a
// negative total, or ANY negative per-area value. Non-negative-with-a-value = not a gap
// (a single filled area is enough -- multi-area does NOT require every area).
import { describe, it, expect } from "vitest";
import type { ReviewRow } from "./boqTypes";
import {
  isLineItemQtyGap,
  countSelectedLineItemsNoQty,
  qtyGapReason,
  buildQtyGapEntries,
  isSelectableRow,
  isQtyEligibleRow,
} from "./templateSelection";

// Narrow fixtures -- the gate reads only qty_total / qty_by_area (+ classification/is_excluded
// for the count), so we cast partial objects (matches reviewRender.test.ts convention).
function row(partial: Partial<ReviewRow>): ReviewRow {
  return partial as unknown as ReviewRow;
}

describe("isLineItemQtyGap", () => {
  it("flags a missing / zero / null total as a gap", () => {
    expect(isLineItemQtyGap(row({ qty_total: null, qty_by_area: null }))).toBe(true);
    expect(isLineItemQtyGap(row({ qty_total: 0, qty_by_area: null }))).toBe(true);
    expect(isLineItemQtyGap(row({ qty_total: undefined as unknown as number }))).toBe(true);
  });

  it("passes a positive single-area total", () => {
    expect(isLineItemQtyGap(row({ qty_total: 5, qty_by_area: null }))).toBe(false);
  });

  it("flags a NEGATIVE total (the backstop -- negative is truthy, so the old !qty_total missed it)", () => {
    expect(isLineItemQtyGap(row({ qty_total: -3, qty_by_area: null }))).toBe(true);
  });

  it("multi-area: one filled area is enough -- does NOT require every area", () => {
    // Tower A = 5, Tower B = 0 -> sum 5 > 0 -> NOT a gap.
    expect(isLineItemQtyGap(row({ qty_total: 5, qty_by_area: { "Tower A": 5, "Tower B": 0 } }))).toBe(false);
  });

  it("multi-area: all areas empty/zero -> gap", () => {
    expect(isLineItemQtyGap(row({ qty_total: 0, qty_by_area: { "Tower A": 0, "Tower B": 0 } }))).toBe(true);
  });

  it("multi-area: a POSITIVE sum with a negative area is still a gap (catches the mixed case)", () => {
    // Tower A = 10, Tower B = -3 -> sum 7 (positive!) but a negative area must block.
    expect(isLineItemQtyGap(row({ qty_total: 7, qty_by_area: { "Tower A": 10, "Tower B": -3 } }))).toBe(true);
  });
});

describe("countSelectedLineItemsNoQty", () => {
  it("counts only SELECTED (included) line items with a gap", () => {
    const rows = [
      row({ effective_classification: "line_item", is_excluded: 0, qty_total: 0 }),      // gap, counted
      row({ effective_classification: "line_item", is_excluded: 0, qty_total: -1 }),     // gap (negative), counted
      row({ effective_classification: "line_item", is_excluded: 0, qty_total: 5 }),      // ok, not counted
      row({ effective_classification: "line_item", is_excluded: 1, qty_total: 0 }),      // excluded -> ignored
      row({ effective_classification: "preamble", is_excluded: 0, qty_total: 0 }),       // not a line item -> ignored
    ];
    expect(countSelectedLineItemsNoQty(rows)).toBe(2);
  });

  it("is 0 when every selected line item has a valid quantity", () => {
    const rows = [
      row({ effective_classification: "line_item", is_excluded: 0, qty_total: 5 }),
      row({ effective_classification: "line_item", is_excluded: 0, qty_total: 1, qty_by_area: { A: 1, B: 0 } }),
    ];
    expect(countSelectedLineItemsNoQty(rows)).toBe(0);
  });
});

describe("isSelectableRow — the quantity ELIGIBILITY gate", () => {
  // Beyond the selection checkbox this now decides TWO more things: whether a row's quantity
  // cell is editable at all, and whether keyboard nav stops on it. Notes / spacers / subtotal
  // markers cannot carry a quantity (the clone leaves their qty_by_area null), and across every
  // template BoQ in the DB not one of them holds a value.
  it("admits exactly preamble + line_item", () => {
    expect(isSelectableRow(row({ effective_classification: "line_item" }))).toBe(true);
    expect(isSelectableRow(row({ effective_classification: "preamble" }))).toBe(true);
  });

  it("rejects the ride-along annotation classes", () => {
    for (const cls of ["note", "spacer", "subtotal_marker", "header_repeat"]) {
      expect(isSelectableRow(row({ effective_classification: cls }))).toBe(false);
    }
  });

  it("rejects a row with no effective classification", () => {
    expect(isSelectableRow(row({ effective_classification: null }))).toBe(false);
  });
});

describe("isQtyEligibleRow — what the qty cell and keyboard nav both gate on", () => {
  it("needs BOTH an eligible classification and selection", () => {
    expect(isQtyEligibleRow(row({ effective_classification: "line_item", is_excluded: 0 }))).toBe(true);
    expect(isQtyEligibleRow(row({ effective_classification: "preamble", is_excluded: 0 }))).toBe(true);
  });

  it("rejects a DESELECTED row even when its classification is eligible", () => {
    // The miss that made nav still stop on 13 rows: classification alone is not eligibility.
    // A deselected row is never committed, so its quantity is dead data.
    expect(isQtyEligibleRow(row({ effective_classification: "line_item", is_excluded: 1 }))).toBe(false);
    expect(isQtyEligibleRow(row({ effective_classification: "preamble", is_excluded: 1 }))).toBe(false);
  });

  it("rejects a ride-along class even when selected", () => {
    for (const cls of ["note", "spacer", "subtotal_marker"]) {
      expect(isQtyEligibleRow(row({ effective_classification: cls, is_excluded: 0 }))).toBe(false);
    }
  });

  it("treats an absent is_excluded as selected (the clone default)", () => {
    expect(isQtyEligibleRow(row({ effective_classification: "line_item" }))).toBe(true);
  });
});

describe("qtyGapReason", () => {
  it("returns null exactly where isLineItemQtyGap is false (same truth set)", () => {
    const cases: Partial<ReviewRow>[] = [
      { qty_total: null, qty_by_area: null },
      { qty_total: 0, qty_by_area: null },
      { qty_total: -3, qty_by_area: null },
      { qty_total: 5, qty_by_area: null },
      { qty_total: 5, qty_by_area: { A: 5, B: 0 } },
      { qty_total: 0, qty_by_area: { A: 0, B: 0 } },
      { qty_total: 7, qty_by_area: { A: 10, B: -3 } },
    ];
    for (const c of cases) {
      expect(qtyGapReason(row(c)) !== null).toBe(isLineItemQtyGap(row(c)));
    }
  });

  it("distinguishes a blank line from a negative one", () => {
    expect(qtyGapReason(row({ qty_total: null }))).toBe("missing");
    expect(qtyGapReason(row({ qty_total: 0 }))).toBe("missing");
    expect(qtyGapReason(row({ qty_total: -3 }))).toBe("negative");
    expect(qtyGapReason(row({ qty_total: 7, qty_by_area: { A: 10, B: -3 } }))).toBe("negative");
  });

  it("prefers NEGATIVE when a row is both blank in total and negative in an area", () => {
    // qty_total falsy AND an area negative -- the actionable reading is the negative value the
    // user can actually see in the cell, not a 'blank' message pointing at a filled input.
    expect(qtyGapReason(row({ qty_total: 0, qty_by_area: { A: -5, B: 0 } }))).toBe("negative");
  });
});

describe("buildQtyGapEntries", () => {
  it("emits one entry per selected gap line item, carrying rowIndex for the jump", () => {
    const rows = [
      row({ row_index: 0, source_row_number: 10, description: "  Wire  ",
            effective_classification: "line_item", is_excluded: 0, qty_total: 0 }),
      row({ row_index: 1, source_row_number: 11, description: "Switch",
            effective_classification: "line_item", is_excluded: 0, qty_total: 5 }),
      row({ row_index: 2, source_row_number: 12, description: "Panel",
            effective_classification: "line_item", is_excluded: 0, qty_total: -2 }),
    ];
    const entries = buildQtyGapEntries(rows);
    expect(entries.map((e) => e.rowIndex)).toEqual([0, 2]);
    expect(entries[0].excelRow).toBe(10);
    expect(entries[0].description).toBe("Wire");            // trimmed for display
    expect(entries[0].reason).toBe("missing");
    expect(entries[1].reason).toBe("negative");
    expect(entries[0].text).not.toEqual(entries[1].text);   // the two states read differently
  });

  it("skips excluded rows and non-line-items (same scope as the finalize gate)", () => {
    const rows = [
      row({ row_index: 0, effective_classification: "line_item", is_excluded: 1, qty_total: 0 }),
      row({ row_index: 1, effective_classification: "preamble", is_excluded: 0, qty_total: 0 }),
      row({ row_index: 2, effective_classification: "note", is_excluded: 0, qty_total: 0 }),
    ];
    expect(buildQtyGapEntries(rows)).toEqual([]);
  });

  it("stays in lockstep with the finalize count (one list, one length)", () => {
    const rows = [
      row({ row_index: 0, effective_classification: "line_item", is_excluded: 0, qty_total: 0 }),
      row({ row_index: 1, effective_classification: "line_item", is_excluded: 0, qty_total: -1 }),
      row({ row_index: 2, effective_classification: "line_item", is_excluded: 0, qty_total: 3 }),
    ];
    expect(buildQtyGapEntries(rows).length).toBe(countSelectedLineItemsNoQty(rows));
  });

  it("tolerates a synthetic row with no source_row_number", () => {
    const rows = [
      // A user-created row carries no source row until the renumber pass fills it in.
      row({ row_index: 4, source_row_number: undefined as unknown as number,
            description: "New line",
            effective_classification: "line_item", is_excluded: 0, qty_total: null }),
    ];
    expect(buildQtyGapEntries(rows)[0].excelRow).toBeNull();
  });
});
