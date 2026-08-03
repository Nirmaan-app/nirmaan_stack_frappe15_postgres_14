/**
 * marginView.test.ts -- the margin view's row set, order and section context (slice BCS-S4).
 *
 * WHAT THIS VIEW IS. A separate FLAT, line-items-only presentation of the pricing sheet, ordered
 * by % Profit, with an ascending/descending toggle, each row carrying its section as context.
 * The owner chose it over sorting the grid in place (2026-08-02): the grid is an N-deep hierarchy
 * with collapse/expand, so a flat re-order makes collapsing a section hide rows from scattered
 * places on screen, while the indentation implies nesting under a parent that is nowhere near.
 * A distinct view, rather than an incoherent tree.
 *
 * ⚠️ THE TEST THAT MATTERS MOST IS THE DESCENDING-BLANKS ONE. Most rows on a real sheet have no
 * margin until someone costs them. The obvious implementation -- substitute a low sentinel for a
 * blank, then flip the comparator for descending -- puts every uncosted row at the TOP of the
 * descending order, which is precisely the wrong end: the whole point of the descending view is
 * to read the best margins first, and it would open on a screenful of nothing. Blanks sort LAST
 * in BOTH directions, which the sentinel idiom does not give you for free.
 *
 * ⚠️ WHY THE SORT LIVES HERE AND NOT IN THE COMPONENT. There is NO DOM test environment in this
 * repo (deliberate, recorded in vitest.config.ts), so anything living in JSX is structurally
 * untestable -- which is how two defects survived the day this slice opened. These tests pin the
 * ORDER, the row SET and the section LABELS; they cannot observe that the page hands the grid the
 * result or that the cursor stays put. That half is live-check only -- see the slice record.
 */
import { describe, expect, it } from "vitest";
import {
  buildMarginOrder,
  buildSectionLabels,
  compareByMargin,
  flipMarginSortDir,
  isMarginViewRow,
  marginViewRows,
  type MarginEntry,
  type MarginViewRowLike,
} from "./marginView";

/** A row shaped like PricedRow's margin-view-relevant fields. */
const row = (
  row_index: number,
  node_type: string | null,
  effective_parent_index: number | null = null,
  description: string | null = null,
): MarginViewRowLike => ({ row_index, node_type, effective_parent_index, description });

const line = (row_index: number, parent: number | null = null, description = "a line") =>
  row(row_index, "Line Item", parent, description);

/** Sort a bare list of margins and read back the order, for the comparator tests. */
const orderOf = (margins: Array<number | null>, dir: "asc" | "desc"): Array<number | null> =>
  margins
    .map((margin, i): MarginEntry => ({ rowIndex: i, margin }))
    .slice()
    .sort((a, b) => compareByMargin(a.margin, b.margin, dir))
    .map((e) => e.margin);

describe("compareByMargin -- blanks sort LAST in BOTH directions", () => {
  it("puts blanks last when ASCENDING", () => {
    expect(orderOf([null, 12, null, -4, 30], "asc")).toEqual([-4, 12, 30, null, null]);
  });

  it("puts blanks last when DESCENDING -- the case the obvious implementation gets wrong", () => {
    // THE DEFECT THIS TEST EXISTS FOR. Substitute a low sentinel for a blank (InventoryReport's
    // `?? -2` idiom) and flip the comparator, and every uncosted row lands at the TOP here.
    // On a fresh sheet that is a screenful of empty rows where the best margins should be.
    expect(orderOf([null, 12, null, -4, 30], "desc")).toEqual([30, 12, -4, null, null]);
  });

  it("keeps blanks last with a leading blank in both directions", () => {
    expect(orderOf([null, 5], "asc")).toEqual([5, null]);
    expect(orderOf([null, 5], "desc")).toEqual([5, null]);
  });

  it("sorts an all-blank list without crashing or reordering", () => {
    expect(orderOf([null, null, null], "desc")).toEqual([null, null, null]);
  });

  it("treats a 0% margin as a REAL value, never as a blank", () => {
    // A zero margin is a finding -- this row makes nothing. Folding it in with "not costed yet"
    // would hide exactly the rows the view is for.
    expect(orderOf([null, 0, 5], "asc")).toEqual([0, 5, null]);
    expect(orderOf([null, 0, 5], "desc")).toEqual([5, 0, null]);
  });

  it("sorts a NEGATIVE margin below every profit, and never treats it as a blank", () => {
    // A loss-making row is the single most important thing this view can surface. It must sit at
    // the bottom of the descending order and the TOP of the ascending one -- not with the blanks.
    expect(orderOf([10, -50, 2], "asc")).toEqual([-50, 2, 10]);
    expect(orderOf([10, -50, 2], "desc")).toEqual([10, 2, -50]);
  });

  it("treats NaN and Infinity as blanks (defensive -- a percentage neither is)", () => {
    // bcsMarginPercent already refuses both, but this comparator is the last line: a NaN compared
    // with < / > is false either way, which would make the sort order depend on input order.
    expect(orderOf([NaN, 7, Number.POSITIVE_INFINITY], "asc")).toEqual([7, NaN, Infinity]);
    expect(orderOf([NaN, 7, Number.POSITIVE_INFINITY], "desc")).toEqual([7, NaN, Infinity]);
  });

  it("reports equal margins as a tie, so the caller's stable sort keeps document order", () => {
    expect(compareByMargin(5, 5, "asc")).toBe(0);
    expect(compareByMargin(5, 5, "desc")).toBe(0);
    expect(compareByMargin(null, null, "asc")).toBe(0);
    expect(compareByMargin(null, null, "desc")).toBe(0);
  });
});

describe("flipMarginSortDir", () => {
  it("flips both ways", () => {
    expect(flipMarginSortDir("asc")).toBe("desc");
    expect(flipMarginSortDir("desc")).toBe("asc");
  });
});

describe("isMarginViewRow -- LINE ITEMS ONLY", () => {
  it("accepts a Line Item", () => {
    expect(isMarginViewRow(row(1, "Line Item"))).toBe(true);
  });

  it("rejects a Preamble, an Other, and an absent node_type", () => {
    // A Preamble can be qty-bearing and therefore costable, but it is a HEADING -- in a flat list
    // sorted by margin it would sit among the lines it introduces, meaning nothing.
    expect(isMarginViewRow(row(1, "Preamble"))).toBe(false);
    expect(isMarginViewRow(row(1, "Other"))).toBe(false);
    expect(isMarginViewRow(row(1, null))).toBe(false);
    expect(isMarginViewRow({ row_index: 1, effective_parent_index: null, description: null })).toBe(
      false,
    );
  });

  it("TRIMS node_type, matching the server's stripped comparison", () => {
    expect(isMarginViewRow(row(1, " Line Item "))).toBe(true);
  });
});

describe("buildMarginOrder -- the SNAPSHOT taken on open and on header click", () => {
  const rows: MarginViewRowLike[] = [
    row(10, "Preamble", null, "Section A"),
    line(11, 10),
    line(12, 10),
    row(13, "Other", 10, "a note"),
    line(14, 10),
  ];
  const margins = new Map<number, number | null>([
    [10, 99], // a Preamble's margin must not enter the order at all
    [11, 40],
    [12, null], // never costed
    [13, 88],
    [14, 5],
  ]);
  const marginOf = (r: MarginViewRowLike) => margins.get(r.row_index) ?? null;

  it("returns row_index values, line items only, worst first when ascending", () => {
    expect(buildMarginOrder(rows, marginOf, "asc")).toEqual([14, 11, 12]);
  });

  it("returns best first when descending, with the uncosted row still last", () => {
    expect(buildMarginOrder(rows, marginOf, "desc")).toEqual([11, 14, 12]);
  });

  it("returns an empty order for a sheet with no line items", () => {
    expect(buildMarginOrder([row(1, "Preamble")], marginOf, "asc")).toEqual([]);
  });
});

describe("marginViewRows -- applying a snapshot order to the CURRENT rows", () => {
  // The order is STATE, captured at open / header click, and deliberately not recomputed while
  // typing: `activeCell` is ARRAY-INDEX addressed inside the grid, so a live re-sort would slide a
  // different row under the cursor mid-keystroke (clipboard multi-row selection is a contiguous
  // array RANGE, with the same exposure). Applying a snapshot to freshly-fetched rows is how the
  // view stays current in its VALUES without ever moving under the user's hands.
  const rows: MarginViewRowLike[] = [line(11), line(12), row(13, "Preamble"), line(14)];

  it("returns the rows in the snapshot's order", () => {
    expect(marginViewRows(rows, [14, 11, 12]).map((r) => r.row_index)).toEqual([14, 11, 12]);
  });

  it("returns the SAME row objects, so downstream by-reference memo compares still hold", () => {
    const out = marginViewRows(rows, [12, 11, 14]);
    expect(out[0]).toBe(rows[1]);
    expect(out[1]).toBe(rows[0]);
  });

  // NOTE on the three expectations below: the un-named line items are APPENDED, not dropped (the
  // rule asserted two tests down). Each of these therefore reads "the named row is placed, the
  // stale/duplicate entry contributes nothing, and the rest follow in document order".
  it("drops non-line-items even if a stale snapshot names one", () => {
    // 13 is a Preamble: it contributes no position. 11 is placed; 12 and 14 follow unsorted.
    expect(marginViewRows(rows, [13, 11]).map((r) => r.row_index)).toEqual([11, 12, 14]);
  });

  it("drops a snapshot entry whose row is gone", () => {
    // 99 no longer exists -- it must not leave a hole or throw.
    expect(marginViewRows(rows, [99, 11]).map((r) => r.row_index)).toEqual([11, 12, 14]);
  });

  it("APPENDS line items missing from the snapshot, in document order -- nothing vanishes", () => {
    // A refetch can introduce a row the snapshot predates. Silently omitting it would be the same
    // class of lie this slice's other half closes: a row that exists, rendered as absent.
    expect(marginViewRows(rows, [14]).map((r) => r.row_index)).toEqual([14, 11, 12]);
  });

  it("ignores a duplicated snapshot entry rather than rendering the row twice", () => {
    // 11 appears once despite being named twice; 14 is the unnamed tail.
    expect(marginViewRows(rows, [11, 11, 12]).map((r) => r.row_index)).toEqual([11, 12, 14]);
  });

  it("falls back to document order for an empty snapshot", () => {
    expect(marginViewRows(rows, []).map((r) => r.row_index)).toEqual([11, 12, 14]);
  });
});

describe("buildSectionLabels -- the context a row loses when the tree is flattened", () => {
  it("labels a line with its NEAREST ancestor that has a description", () => {
    const rows: MarginViewRowLike[] = [
      row(1, "Preamble", null, "ELECTRICAL WORKS"),
      row(2, "Preamble", 1, "Cabling"),
      line(3, 2),
    ];

    expect(buildSectionLabels(rows).get(3)).toBe("Cabling");
  });

  it("skips an ancestor whose description is blank or whitespace", () => {
    const rows: MarginViewRowLike[] = [
      row(1, "Preamble", null, "ELECTRICAL WORKS"),
      row(2, "Preamble", 1, "   "),
      line(3, 2),
    ];

    expect(buildSectionLabels(rows).get(3)).toBe("ELECTRICAL WORKS");
  });

  it("trims the label", () => {
    const rows: MarginViewRowLike[] = [row(1, "Preamble", null, "  Cabling  "), line(2, 1)];

    expect(buildSectionLabels(rows).get(2)).toBe("Cabling");
  });

  it("gives a root row no section rather than inventing one", () => {
    expect(buildSectionLabels([line(1, null)]).get(1)).toBeUndefined();
  });

  it("gives a row no section when no ancestor has a description", () => {
    const rows: MarginViewRowLike[] = [row(1, "Preamble", null, ""), line(2, 1)];

    expect(buildSectionLabels(rows).get(2)).toBeUndefined();
  });

  it("survives a parent that is not in the row set", () => {
    expect(buildSectionLabels([line(2, 999)]).get(2)).toBeUndefined();
  });

  it("survives a PARENT CYCLE without hanging", () => {
    // The same hazard computeDepths guards. A cycle cannot arise from the parser, but human
    // re-parenting writes effective_parent_index and an infinite walk here would freeze the tab.
    const rows: MarginViewRowLike[] = [
      row(1, "Preamble", 2, "A"),
      row(2, "Preamble", 1, "B"),
      line(3, 1),
    ];

    expect(buildSectionLabels(rows).get(3)).toBe("A"); // the first hit still wins
    expect(buildSectionLabels(rows).get(1)).toBe("B"); // ...and the cycle terminates
  });

  it("labels every line item on a sheet in one pass", () => {
    const rows: MarginViewRowLike[] = [
      row(1, "Preamble", null, "Section A"),
      line(2, 1),
      line(3, 1),
      row(4, "Preamble", null, "Section B"),
      line(5, 4),
    ];
    const labels = buildSectionLabels(rows);

    expect(labels.get(2)).toBe("Section A");
    expect(labels.get(3)).toBe("Section A");
    expect(labels.get(5)).toBe("Section B");
  });
});
