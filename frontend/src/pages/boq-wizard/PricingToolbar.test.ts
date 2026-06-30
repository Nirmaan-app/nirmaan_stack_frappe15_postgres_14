// Unit tests for the pricing-editor TOOLBAR PART 1 pure helpers (search / row-type filter /
// column-hide), exported from PricingGrid.tsx -- the established home for the editor's SDK-free
// page-level pure logic (alongside deriveSaveStatus / isGridOnlySheet / shouldExitFullscreenOnEsc).
//
// The JSX (the search input, the Columns popover, the row-type checkboxes, the grid highlight) is
// manual-cert (no jsdom / RTL in this env); only the pure functions that DRIVE them are unit-tested:
//   - searchMatches / buildSearchHits / stepHit / isCurrentHitRow  (search)
//   - classificationVisible                                        (row-type filter)
//   - hideableDescriptors / isColumnVisible                        (column-hide)
// Plus the load-bearing VIEW-ONLY invariant: the row-type filter narrows only the rendered set; the
// priced-count / Summary / flag feed read the UNFILTERED rows, so filtering can never move a number.
import { describe, it, expect } from "vitest";
import {
  searchMatches,
  buildSearchHits,
  stepHit,
  isCurrentHitRow,
  classificationVisible,
  hideableDescriptors,
  isColumnVisible,
} from "./PricingGrid";
import type { ColumnDescriptor, PricedRow } from "./boqTypes";

// ── Fixtures ─────────────────────────────────────────────────────────────────────
function desc(value_field: string, role = "r", col = "X", area: string | null = null): ColumnDescriptor {
  return { col, role, area, value_field, value_key: area, rate_subkey: null };
}
// Minimal PricedRow -- the helpers read ONLY description / source_row_number / effective_classification.
function prow(
  source_row_number: number,
  description: string | null,
  effective_classification: string | null = "line_item",
): PricedRow {
  return { source_row_number, description, effective_classification } as unknown as PricedRow;
}

// ── SEARCH MATCHER ─────────────────────────────────────────────────────────────────
describe("searchMatches", () => {
  it("matches a description containing the query, case-insensitively", () => {
    expect(searchMatches("Reinforced Concrete M25", "concrete")).toBe(true);
    expect(searchMatches("Reinforced Concrete M25", "CONCRETE")).toBe(true);
    expect(searchMatches("reinforced concrete m25", "Concrete M25")).toBe(true);
  });

  it("does NOT match a description that lacks the query", () => {
    expect(searchMatches("Reinforced Concrete M25", "steel")).toBe(false);
  });

  it("empty / whitespace-only query matches nothing (no filtering at rest)", () => {
    expect(searchMatches("anything", "")).toBe(false);
    expect(searchMatches("anything", "   ")).toBe(false);
  });

  it("NEG: a null/undefined description does not throw and is not a hit", () => {
    expect(() => searchMatches(null, "x")).not.toThrow();
    expect(() => searchMatches(undefined, "x")).not.toThrow();
    expect(searchMatches(null, "x")).toBe(false);
    expect(searchMatches(undefined, "x")).toBe(false);
  });
});

// ── SEARCH HIT-LIST ────────────────────────────────────────────────────────────────
describe("buildSearchHits", () => {
  const rows = [
    prow(10, "Excavation in ordinary soil"),
    prow(11, "Reinforced concrete"),
    prow(12, null), // a row with no description -- must be skipped, never throw
    prow(13, "Plain CONCRETE blinding"),
  ];

  it("returns the ordered Excel row numbers of matching rows (case-insensitive)", () => {
    expect(buildSearchHits(rows, "concrete")).toEqual([11, 13]);
  });

  it("empty query yields zero hits (no filtering)", () => {
    expect(buildSearchHits(rows, "")).toEqual([]);
    expect(buildSearchHits(rows, "   ")).toEqual([]);
  });

  it("NEG: a null-description row never throws and never appears as a hit", () => {
    expect(() => buildSearchHits(rows, "soil")).not.toThrow();
    expect(buildSearchHits(rows, "soil")).toEqual([10]);
  });
});

// ── STEPPER + CURRENT-HIT ────────────────────────────────────────────────────────────
describe("stepHit", () => {
  it("wraps at both ends: prev at 0 -> last, next at last -> 0", () => {
    const len = 3; // indices 0,1,2
    expect(stepHit(0, len, "prev")).toBe(2); // wrap to last
    expect(stepHit(2, len, "next")).toBe(0); // wrap to first
  });

  it("steps within the range otherwise", () => {
    expect(stepHit(0, 3, "next")).toBe(1);
    expect(stepHit(2, 3, "prev")).toBe(1);
  });

  it("returns 0 for an empty hit list", () => {
    expect(stepHit(0, 0, "next")).toBe(0);
    expect(stepHit(0, 0, "prev")).toBe(0);
  });
});

describe("isCurrentHitRow", () => {
  it("is true for EXACTLY the current-index row, false otherwise", () => {
    const hits = [11, 13, 20];
    const currentIdx = 1; // -> excel row 13
    const current = hits[currentIdx];
    expect(isCurrentHitRow(13, current)).toBe(true);
    expect(isCurrentHitRow(11, current)).toBe(false);
    expect(isCurrentHitRow(20, current)).toBe(false);
  });

  it("is false when there is no current hit (null/undefined)", () => {
    expect(isCurrentHitRow(13, null)).toBe(false);
    expect(isCurrentHitRow(13, undefined)).toBe(false);
  });
});

// ── ROW-TYPE PREDICATE ────────────────────────────────────────────────────────────
describe("classificationVisible", () => {
  const ALL_ON = { showSpacers: true, showNotes: true, showSubtotals: true };

  it("showSpacers=false hides 'spacer' and shows every other type", () => {
    const t = { ...ALL_ON, showSpacers: false };
    expect(classificationVisible("spacer", t)).toBe(false);
    expect(classificationVisible("note", t)).toBe(true);
    expect(classificationVisible("subtotal_marker", t)).toBe(true);
    expect(classificationVisible("line_item", t)).toBe(true);
  });

  it("showNotes=false hides 'note' only", () => {
    const t = { ...ALL_ON, showNotes: false };
    expect(classificationVisible("note", t)).toBe(false);
    expect(classificationVisible("spacer", t)).toBe(true);
    expect(classificationVisible("subtotal_marker", t)).toBe(true);
  });

  it("showSubtotals=false hides 'subtotal_marker' only", () => {
    const t = { ...ALL_ON, showSubtotals: false };
    expect(classificationVisible("subtotal_marker", t)).toBe(false);
    expect(classificationVisible("note", t)).toBe(true);
    expect(classificationVisible("spacer", t)).toBe(true);
  });

  it("all three true -> nothing is hidden", () => {
    for (const cls of ["spacer", "note", "subtotal_marker", "line_item", "preamble", "header_repeat", null]) {
      expect(classificationVisible(cls, ALL_ON)).toBe(true);
    }
  });

  it("NEG: a line_item / preamble / header_repeat / null is NEVER hidden by any toggle", () => {
    const allOff = { showSpacers: false, showNotes: false, showSubtotals: false };
    expect(classificationVisible("line_item", allOff)).toBe(true);
    expect(classificationVisible("preamble", allOff)).toBe(true);
    expect(classificationVisible("header_repeat", allOff)).toBe(true);
    expect(classificationVisible(null, allOff)).toBe(true);
  });
});

// ── HIDEABLE-COLUMN FILTER ──────────────────────────────────────────────────────────
describe("hideableDescriptors", () => {
  const cols = [
    desc("description", "description", "B"), // fixed anchor -> NOT hideable
    desc("qty_total", "qty", "C"), // non-amount -> hideable
    desc("amount_total", "amount_total", "D"), // amount -> NOT hideable (locked)
    desc("rate_supply", "rate_supply", "E"), // non-amount -> hideable
    desc("amount_by_area", "amount_by_area", "F", "Zone A"), // per-area amount -> NOT hideable
  ];

  it("excludes amount columns (scalar AND per-area) and fixed anchors; keeps the rest", () => {
    expect(hideableDescriptors(cols).map((d) => d.col)).toEqual(["C", "E"]);
  });

  it("an amount column is NEVER in the hideable set", () => {
    const out = hideableDescriptors(cols);
    expect(out.find((d) => d.col === "D")).toBeUndefined();
    expect(out.find((d) => d.col === "F")).toBeUndefined();
  });
});

describe("isColumnVisible", () => {
  const amountCol = desc("amount_total", "amount_total", "D");
  const perAreaAmountCol = desc("amount_by_area", "amount_by_area", "F", "Zone A");
  const qtyCol = desc("qty_total", "qty", "C");

  it("a non-amount column is hidden iff it is in hiddenCols", () => {
    expect(isColumnVisible(qtyCol, new Set(["C"]))).toBe(false);
    expect(isColumnVisible(qtyCol, new Set(["Z"]))).toBe(true);
    expect(isColumnVisible(qtyCol, new Set())).toBe(true);
  });

  it("default (undefined hiddenCols) => every column is visible", () => {
    expect(isColumnVisible(qtyCol, undefined)).toBe(true);
    expect(isColumnVisible(amountCol, undefined)).toBe(true);
  });

  it("NEG: an amount column ALWAYS renders, even when present in hiddenCols", () => {
    expect(isColumnVisible(amountCol, new Set(["D"]))).toBe(true);
    expect(isColumnVisible(perAreaAmountCol, new Set(["F"]))).toBe(true);
  });
});

// ── VIEW-ONLY INVARIANT (load-bearing) ──────────────────────────────────────────────
// The row-type filter narrows ONLY the rendered set (displayRows). The priced-count, Summary, and
// flag feed read the UNFILTERED `rows`. We encode that by emulating the displayRows .filter() and
// asserting the source array (the count input) is untouched and a filtered-out row is still present.
describe("row-type filter is VIEW-ONLY", () => {
  it("a filtered-out spacer is gone from the rendered set but still in the unfiltered count input", () => {
    const lineItem = prow(1, "Concrete", "line_item");
    const spacer = prow(2, "", "spacer");
    const subtotal = prow(3, "Sub-total", "subtotal_marker");
    const rows = [lineItem, spacer, subtotal];

    // Emulate displayRows with spacers + subtotals hidden (the same predicate the page composes).
    const toggles = { showSpacers: false, showNotes: true, showSubtotals: false };
    const rendered = rows.filter((r) => classificationVisible(r.effective_classification, toggles));

    expect(rendered).toEqual([lineItem]); // VIEW: spacer + subtotal hidden
    expect(rows).toEqual([lineItem, spacer, subtotal]); // COUNT input: intact (filter never mutates)
    expect(rows.length).toBe(3);
  });
});
