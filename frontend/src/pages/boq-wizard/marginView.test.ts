// Unit tests for the pure % Margin RANGE FILTER (BCS-S13) and IN-PLACE SORT (BCS-S14).
//
// ⚠️ THIS FILE USED TO COVER THE MARGIN VIEW. The owner removed that view on 2026-08-07 in favour
// of two controls on the % Margin column header. The section-label suite went with the code it
// covered; the ORDERING suites came back with the sort, re-pointed at the two places in-place
// sorting differs from the view's (every row is ranked, and every row comes back).
import { describe, it, expect } from "vitest";
import {
  buildMarginOrder,
  compareByMargin,
  describeMarginRange,
  marginInRange,
  marginRangeActive,
  marginRangeRowSet,
  marginSortRows,
  nextMarginSort,
  parseMarginBound,
} from "./marginView";

// ── BCS-S13: the % Margin range filter ───────────────────────────────────────
describe("margin range filter", () => {
  it("parses a bound, treating blank and partial input as OPEN", () => {
    expect(parseMarginBound("10")).toBe(10);
    expect(parseMarginBound(" -12.5 ")).toBe(-12.5);
    expect(parseMarginBound("")).toBeNull();
    expect(parseMarginBound("-")).toBeNull();   // mid-typing a negative
    expect(parseMarginBound("abc")).toBeNull();
    expect(parseMarginBound(null)).toBeNull();
  });

  it("is inactive when both bounds are open -- never an empty grid by default", () => {
    expect(marginRangeActive(null, null)).toBe(false);
    expect(marginRangeActive(0, null)).toBe(true);
    expect(marginRangeActive(null, 0)).toBe(true);
  });

  it("is INCLUSIVE at both ends", () => {
    expect(marginInRange(0, 0, 10)).toBe(true);
    expect(marginInRange(10, 0, 10)).toBe(true);
    expect(marginInRange(-0.1, 0, 10)).toBe(false);
    expect(marginInRange(10.1, 0, 10)).toBe(false);
  });

  it("one open side means unbounded on that side", () => {
    expect(marginInRange(-200, null, 0)).toBe(true);   // everything at or below 0
    expect(marginInRange(5, null, 0)).toBe(false);
    expect(marginInRange(500, 10, null)).toBe(true);   // everything at or above 10
  });

  it("handles NEGATIVE margins, which is the point of the filter", () => {
    expect(marginInRange(-200, -300, -100)).toBe(true);
    expect(marginInRange(-50, -300, -100)).toBe(false);
  });

  it("★ a row with NO margin is excluded while the filter is active", () => {
    // Not "outside the range" -- UNKNOWN. Keeping unknowns visible would let a range matching
    // nothing still render a full grid, which reads as a broken filter.
    expect(marginInRange(null, 0, 10)).toBe(false);
    expect(marginInRange(undefined, 0, 10)).toBe(false);
    expect(marginInRange(NaN, 0, 10)).toBe(false);
  });

  it("REVERSED bounds describe the same interval rather than matching nothing", () => {
    expect(marginInRange(5, 15, -10)).toBe(true);
    expect(marginInRange(-20, 15, -10)).toBe(false);
  });

  it("builds the row set from the SAME margins the screen shows", () => {
    const rows = [{ row_index: 1 }, { row_index: 2 }, { row_index: 3 }];
    const margins = new Map<number, number | null>([[1, 40], [2, -200], [3, null]]);
    const set = marginRangeRowSet(rows, (r) => margins.get(r.row_index) ?? null, 0, 100);
    expect([...set]).toEqual([1]);
  });

  it("★ membership is the MARGIN, never the row's node_type", () => {
    // The flat margin view this filter replaced was line-items-only, a presentational choice.
    // As a filter that would contradict the column: the grid renders % Margin on every row that
    // has one, so a qty-bearing PREAMBLE showing 15% must survive a 10-25% range rather than
    // vanish next to line items that stayed.
    const rows = [{ row_index: 1 }, { row_index: 2 }];
    const margins = new Map<number, number | null>([
      [1, 15], // the preamble, in band
      [2, 15], // a line item with the identical margin
    ]);
    const set = marginRangeRowSet(rows, (r) => margins.get(r.row_index) ?? null, 10, 25);
    expect([...set]).toEqual([1, 2]);
  });

  it("rows with no margin (spacers, notes, uncosted preambles) drop out on the margin alone", () => {
    // Which is why dropping the node_type test lost nothing: an absent margin is already excluded.
    const rows = [{ row_index: 1 }, { row_index: 2 }];
    const margins = new Map<number, number | null>([[1, null], [2, 12]]);
    const set = marginRangeRowSet(rows, (r) => margins.get(r.row_index) ?? null, 10, 25);
    expect([...set]).toEqual([2]);
  });
});

describe("describeMarginRange", () => {
  it("reads as a continuation of 'a % Margin ...' in every shape", () => {
    // One phrasing serves both the funnel tooltip and the grid's empty state, so it must embed
    // in a sentence without either caller re-shaping the grammar.
    expect(describeMarginRange("10", "25")).toBe("between 10% and 25%");
    expect(describeMarginRange("10", "")).toBe("of 10% or more");
    expect(describeMarginRange("", "25")).toBe("of 25% or less");
  });

  it("normalises reversed bounds, matching marginInRange", () => {
    // The phrase must state the interval actually APPLIED, not the order it was typed in.
    expect(describeMarginRange("25", "10")).toBe("between 10% and 25%");
  });

  it("is empty when no range is set, so a caller can branch on it", () => {
    expect(describeMarginRange("", "")).toBe("");
    expect(describeMarginRange(null, undefined)).toBe("");
    expect(describeMarginRange("abc", "-")).toBe(""); // unparseable == open, per parseMarginBound
  });

  it("handles negative and fractional bounds", () => {
    expect(describeMarginRange("-10", "5.5")).toBe("between -10% and 5.5%");
    expect(describeMarginRange("", "-2")).toBe("of -2% or less");
  });
});

// ── BCS-S14: the % Margin in-place sort ──────────────────────────────────────
describe("nextMarginSort", () => {
  it("cycles off -> asc -> desc -> off, so document order is always reachable", () => {
    expect(nextMarginSort(null)).toBe("asc"); // worst margin first -- the first question asked
    expect(nextMarginSort("asc")).toBe("desc");
    expect(nextMarginSort("desc")).toBeNull();
  });
});

describe("compareByMargin", () => {
  it("orders ascending (worst first) and descending (best first)", () => {
    expect(compareByMargin(10, 20, "asc")).toBeLessThan(0);
    expect(compareByMargin(10, 20, "desc")).toBeGreaterThan(0);
  });

  it("★ BLANKS SORT LAST IN BOTH DIRECTIONS", () => {
    // The sentinel idiom gets this right in one direction and backwards in the other. Descending
    // is the one that breaks, and it is the worse one: an uncosted sheet would open on a
    // screenful of nothing exactly where the best margins belong.
    expect(compareByMargin(null, 10, "asc")).toBeGreaterThan(0);
    expect(compareByMargin(null, 10, "desc")).toBeGreaterThan(0);
    expect(compareByMargin(10, null, "asc")).toBeLessThan(0);
    expect(compareByMargin(10, null, "desc")).toBeLessThan(0);
  });

  it("treats NaN / Infinity as blanks, never as numbers", () => {
    // A NaN reaching a comparator makes every comparison false, so the order would depend on
    // input order -- a silent, unreproducible sort.
    expect(compareByMargin(NaN, 10, "asc")).toBeGreaterThan(0);
    expect(compareByMargin(Infinity, 10, "desc")).toBeGreaterThan(0);
  });

  it("0 and NEGATIVE margins are REAL values, not blanks", () => {
    // "makes nothing" and "loses money" are the findings the sort exists to surface.
    expect(compareByMargin(-50, 0, "asc")).toBeLessThan(0);
    expect(compareByMargin(0, 10, "asc")).toBeLessThan(0);
    expect(compareByMargin(-50, null, "desc")).toBeLessThan(0);
  });

  it("ties return 0, so a stable sort keeps document order", () => {
    expect(compareByMargin(10, 10, "asc")).toBe(0);
    expect(compareByMargin(null, null, "desc")).toBe(0);
  });
});

describe("buildMarginOrder", () => {
  it("ranks by margin, blanks last", () => {
    const rows = [{ row_index: 1 }, { row_index: 2 }, { row_index: 3 }, { row_index: 4 }];
    const margins = new Map<number, number | null>([[1, 40], [2, null], [3, -10], [4, 5]]);
    const of = (r: { row_index: number }) => margins.get(r.row_index) ?? null;
    expect(buildMarginOrder(rows, of, "asc")).toEqual([3, 4, 1, 2]);
    expect(buildMarginOrder(rows, of, "desc")).toEqual([1, 4, 3, 2]);
  });

  it("★ ranks EVERY row, not just line items", () => {
    // The deleted view ranked line items only. In place, an unranked row is a row that vanishes
    // from the grid -- so membership is no longer a curation decision.
    const rows = [{ row_index: 1 }, { row_index: 2 }, { row_index: 3 }];
    const margins = new Map<number, number | null>([[1, null], [2, null], [3, 7]]);
    const order = buildMarginOrder(rows, (r) => margins.get(r.row_index) ?? null, "asc");
    expect(order).toHaveLength(3);
    expect([...order].sort()).toEqual([1, 2, 3]);
  });
});

describe("marginSortRows", () => {
  it("reorders by the held ranking and returns rows BY REFERENCE", () => {
    const a = { row_index: 1 };
    const b = { row_index: 2 };
    const c = { row_index: 3 };
    const out = marginSortRows([a, b, c], [3, 1, 2]);
    expect(out.map((r) => r.row_index)).toEqual([3, 1, 2]);
    expect(out[0]).toBe(c); // identity preserved -- the row memo compares by reference
  });

  it("★ a row the ranking does not name is APPENDED, never dropped", () => {
    // This output IS the grid's row set. Dropping an unranked row silently deletes it from the
    // sheet, and a sorted sheet is not a place anyone counts rows.
    const rows = [{ row_index: 1 }, { row_index: 2 }, { row_index: 3 }];
    const out = marginSortRows(rows, [3]); // a stale snapshot naming only one row
    expect(out.map((r) => r.row_index)).toEqual([3, 1, 2]);
  });

  it("★ unranked rows keep DOCUMENT ORDER among themselves (the Infinity-NaN trap)", () => {
    // Both score Infinity; a subtracting comparator returns NaN for that pair and the result
    // becomes engine-dependent.
    const rows = [{ row_index: 5 }, { row_index: 6 }, { row_index: 7 }];
    expect(marginSortRows(rows, []).map((r) => r.row_index)).toEqual([5, 6, 7]);
  });

  it("drops a stale entry and honours a duplicate once, at its first appearance", () => {
    const rows = [{ row_index: 1 }, { row_index: 2 }];
    const out = marginSortRows(rows, [2, 99, 2, 1]); // 99 is gone; 2 is named twice
    expect(out.map((r) => r.row_index)).toEqual([2, 1]);
  });

  it("an empty sheet stays empty", () => {
    expect(marginSortRows([], [1, 2])).toEqual([]);
  });
});
