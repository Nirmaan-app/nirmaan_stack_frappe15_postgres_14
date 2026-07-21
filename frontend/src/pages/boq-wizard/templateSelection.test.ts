// Unit tests for the template-flow quantity gate (A2 negative rule + at-least-one-area).
//
// isLineItemQtyGap mirrors the backend `_template_line_item_qty_gap` (review_screen.py) --
// the two must agree (ADR-0010 F1 FE<->BE parity). "gap" = the row would BLOCK finalize:
// missing/zero total (all areas empty for multi-area, since qty_total = sum(areas)), a
// negative total, or ANY negative per-area value. Non-negative-with-a-value = not a gap
// (a single filled area is enough -- multi-area does NOT require every area).
import { describe, it, expect } from "vitest";
import type { ReviewRow } from "./boqTypes";
import { isLineItemQtyGap, countSelectedLineItemsNoQty } from "./templateSelection";

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
