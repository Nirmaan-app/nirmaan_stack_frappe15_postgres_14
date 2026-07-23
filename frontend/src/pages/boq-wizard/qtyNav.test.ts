// Unit tests for the template review screen's quantity-column keyboard navigation.
//
// The movement contract (mirrors PricingGrid's nextCell, minus left/right -- those belong to
// the caret inside a numeric input): arrows STOP at edges, Enter maps to down, Tab moves right
// and wraps to the next row, Shift-Tab reverses, and Tab off either end returns null so focus
// stays contained in the grid. Rows are RAGGED (column visibility differs), so vertical moves
// clamp rather than assume a uniform width.
import { describe, it, expect } from "vitest";
import {
  nextQtyCell,
  qtyNavDirectionFor,
  qtyCellKey,
  qtyCellKeyAt,
  findQtyCoord,
  type QtyNavMatrix,
} from "./qtyNav";

// Single-area sheet: one Total cell per row (row_index 10, 11, 12).
const SINGLE: QtyNavMatrix = [
  { rowIndex: 10, cols: ["D"] },
  { rowIndex: 11, cols: ["D"] },
  { rowIndex: 12, cols: ["D"] },
];

// Multi-area sheet: two area columns per row.
const MULTI: QtyNavMatrix = [
  { rowIndex: 10, cols: ["D", "E"] },
  { rowIndex: 11, cols: ["D", "E"] },
];

describe("qtyNavDirectionFor", () => {
  it("maps the keys we own and ignores the rest", () => {
    expect(qtyNavDirectionFor({ key: "ArrowUp" })).toBe("up");
    expect(qtyNavDirectionFor({ key: "ArrowDown" })).toBe("down");
    expect(qtyNavDirectionFor({ key: "Enter" })).toBe("down");
    expect(qtyNavDirectionFor({ key: "Tab" })).toBe("tab");
    expect(qtyNavDirectionFor({ key: "Tab", shiftKey: true })).toBe("shift-tab");
  });

  it("leaves ArrowLeft/ArrowRight to the caret (NOT navigation)", () => {
    expect(qtyNavDirectionFor({ key: "ArrowLeft" })).toBeNull();
    expect(qtyNavDirectionFor({ key: "ArrowRight" })).toBeNull();
  });

  it("ignores typing and Escape", () => {
    expect(qtyNavDirectionFor({ key: "5" })).toBeNull();
    expect(qtyNavDirectionFor({ key: "Escape" })).toBeNull();
    expect(qtyNavDirectionFor({ key: "Backspace" })).toBeNull();
  });
});

describe("nextQtyCell -- vertical", () => {
  it("moves down and up the column", () => {
    expect(nextQtyCell({ row: 0, col: 0 }, "down", SINGLE)).toEqual({ row: 1, col: 0 });
    expect(nextQtyCell({ row: 1, col: 0 }, "up", SINGLE)).toEqual({ row: 0, col: 0 });
  });

  it("STOPS at the edges (no wrap)", () => {
    expect(nextQtyCell({ row: 0, col: 0 }, "up", SINGLE)).toBeNull();
    expect(nextQtyCell({ row: 2, col: 0 }, "down", SINGLE)).toBeNull();
  });

  it("holds the column when moving vertically in a multi-area sheet", () => {
    expect(nextQtyCell({ row: 0, col: 1 }, "down", MULTI)).toEqual({ row: 1, col: 1 });
  });

  it("clamps into a NARROWER row rather than landing out of range", () => {
    // The middle row rendered only one qty column (the second is hidden).
    const ragged: QtyNavMatrix = [
      { rowIndex: 10, cols: ["D", "E"] },
      { rowIndex: 11, cols: ["D"] },
      { rowIndex: 12, cols: ["D", "E"] },
    ];
    expect(nextQtyCell({ row: 0, col: 1 }, "down", ragged)).toEqual({ row: 1, col: 0 });
  });

  it("skips rows with no navigable cell instead of swallowing the keystroke", () => {
    const withGap: QtyNavMatrix = [
      { rowIndex: 10, cols: ["D"] },
      { rowIndex: 11, cols: [] },
      { rowIndex: 12, cols: ["D"] },
    ];
    expect(nextQtyCell({ row: 0, col: 0 }, "down", withGap)).toEqual({ row: 2, col: 0 });
    expect(nextQtyCell({ row: 2, col: 0 }, "up", withGap)).toEqual({ row: 0, col: 0 });
  });
});

describe("nextQtyCell -- Tab", () => {
  it("moves across the areas within a row", () => {
    expect(nextQtyCell({ row: 0, col: 0 }, "tab", MULTI)).toEqual({ row: 0, col: 1 });
  });

  it("WRAPS to the next row's first cell at the end of a row", () => {
    expect(nextQtyCell({ row: 0, col: 1 }, "tab", MULTI)).toEqual({ row: 1, col: 0 });
  });

  it("shift-tab reverses, wrapping back to the previous row's LAST cell", () => {
    expect(nextQtyCell({ row: 1, col: 1 }, "shift-tab", MULTI)).toEqual({ row: 1, col: 0 });
    expect(nextQtyCell({ row: 1, col: 0 }, "shift-tab", MULTI)).toEqual({ row: 0, col: 1 });
  });

  it("returns null at the very ends so focus stays inside the grid", () => {
    expect(nextQtyCell({ row: 1, col: 1 }, "tab", MULTI)).toBeNull();          // last cell
    expect(nextQtyCell({ row: 0, col: 0 }, "shift-tab", MULTI)).toBeNull();    // first cell
  });

  it("single-area Tab walks straight down the column", () => {
    expect(nextQtyCell({ row: 0, col: 0 }, "tab", SINGLE)).toEqual({ row: 1, col: 0 });
  });
});

describe("nextQtyCell -- degenerate input", () => {
  it("returns null for an empty matrix or an out-of-range origin", () => {
    expect(nextQtyCell({ row: 0, col: 0 }, "down", [])).toBeNull();
    expect(nextQtyCell({ row: 9, col: 0 }, "down", SINGLE)).toBeNull();
    expect(nextQtyCell({ row: -1, col: 0 }, "up", SINGLE)).toBeNull();
  });
});

describe("registry keys", () => {
  it("keys on the DURABLE row_index, not the array position", () => {
    // Matrix position 0 is row_index 10 -- a collapse/filter reshuffle changes the position but
    // never the key, which is exactly why the registry keys on row_index.
    expect(qtyCellKeyAt(SINGLE, { row: 0, col: 0 })).toBe(qtyCellKey(10, "D"));
    expect(qtyCellKeyAt(MULTI, { row: 1, col: 1 })).toBe(qtyCellKey(11, "E"));
  });

  it("returns null for an out-of-range coordinate", () => {
    expect(qtyCellKeyAt(SINGLE, { row: 5, col: 0 })).toBeNull();
    expect(qtyCellKeyAt(SINGLE, { row: 0, col: 3 })).toBeNull();
  });

  it("findQtyCoord inverts the mapping", () => {
    expect(findQtyCoord(MULTI, 11, "E")).toEqual({ row: 1, col: 1 });
    expect(findQtyCoord(MULTI, 11, "Z")).toBeNull();   // column not navigable
    expect(findQtyCoord(MULTI, 99, "D")).toBeNull();   // row not in the matrix
  });
});
