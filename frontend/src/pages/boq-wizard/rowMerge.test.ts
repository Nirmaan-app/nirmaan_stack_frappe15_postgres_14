// Unit tests for the PURE row-identity merge (BoQ Phase 5 perf fix #1(c)). The whole point is
// IDENTITY PRESERVATION: an unchanged row must return the SAME object reference (so the grid memo
// holds and only the edited row re-renders). Mirrors clipboard.test.ts / undoHistory.test.ts.
import { describe, it, expect } from "vitest";
import { mergeRowsPreservingIdentity, rowOverlayEqual } from "./rowMerge";
import type { PricedRow } from "./boqTypes";

// A minimal row stub -- the merge only reads row_index + the overlay fields. Cast through unknown.
const row = (
  row_index: number,
  overlay: Partial<{
    rate_by_area: unknown;
    priced_by_area: unknown;
    rate_combined: number;
    priced_rate_combined: boolean;
    remark: string | null;
    color_by_cell: unknown;
  }> = {},
): PricedRow => ({ row_index, source_row_number: row_index, ...overlay }) as unknown as PricedRow;

describe("rowOverlayEqual", () => {
  it("equal when all overlay fields match (incl. absent)", () => {
    expect(rowOverlayEqual(row(1), row(1))).toBe(true);
    expect(
      rowOverlayEqual(
        row(1, { rate_by_area: { "Phase 1": { combined_rate: 10 } }, priced_by_area: { "Phase 1": { combined_rate: true } } }),
        row(1, { rate_by_area: { "Phase 1": { combined_rate: 10 } }, priced_by_area: { "Phase 1": { combined_rate: true } } }),
      ),
    ).toBe(true);
  });

  it("unequal when a per-area rate changes", () => {
    expect(
      rowOverlayEqual(
        row(1, { rate_by_area: { "Phase 1": { combined_rate: 10 } } }),
        row(1, { rate_by_area: { "Phase 1": { combined_rate: 11 } } }),
      ),
    ).toBe(false);
  });

  it("unequal when the priced marker flips", () => {
    expect(rowOverlayEqual(row(1, { priced_rate_combined: false }), row(1, { priced_rate_combined: true }))).toBe(false);
    expect(rowOverlayEqual(row(1), row(1, { priced_by_area: { "Phase 1": { combined_rate: true } } }))).toBe(false);
  });

  it("unequal when a scalar rate changes", () => {
    expect(rowOverlayEqual(row(1, { rate_combined: 5 }), row(1, { rate_combined: 6 }))).toBe(false);
  });

  it("unequal when the remark changes (remark save also refetches)", () => {
    expect(rowOverlayEqual(row(1, { remark: "a" }), row(1, { remark: "b" }))).toBe(false);
    expect(rowOverlayEqual(row(1, { remark: null }), row(1, { remark: "x" }))).toBe(false);
  });

  it("unequal when a cell color changes (color save also refetches)", () => {
    expect(rowOverlayEqual(row(1, { color_by_cell: { D: "red" } }), row(1, { color_by_cell: { D: "blue" } }))).toBe(false);
    expect(rowOverlayEqual(row(1), row(1, { color_by_cell: { D: "red" } }))).toBe(false);
  });
});

describe("mergeRowsPreservingIdentity", () => {
  it("reuses the SAME object for an unchanged row (the core property)", () => {
    const prev = [row(1, { rate_combined: 10 }), row(2, { rate_combined: 20 })];
    const next = [row(1, { rate_combined: 10 }), row(2, { rate_combined: 20 })]; // fresh objects, same content
    const merged = mergeRowsPreservingIdentity(prev, next);
    expect(merged[0]).toBe(prev[0]); // reused
    expect(merged[1]).toBe(prev[1]); // reused
  });

  it("returns the NEW object for a row whose rate changed; reuses the rest", () => {
    const prev = [row(1, { rate_combined: 10 }), row(2, { rate_combined: 20 })];
    const next = [row(1, { rate_combined: 99 }), row(2, { rate_combined: 20 })]; // row 1 edited
    const merged = mergeRowsPreservingIdentity(prev, next);
    expect(merged[0]).toBe(next[0]); // changed -> new
    expect(merged[1]).toBe(prev[1]); // unchanged -> reused
  });

  it("returns the NEW object when only the remark changed", () => {
    const prev = [row(1, { remark: "old" })];
    const next = [row(1, { remark: "new" })];
    const merged = mergeRowsPreservingIdentity(prev, next);
    expect(merged[0]).toBe(next[0]);
  });

  it("uses the new object for a brand-new row_index", () => {
    const prev = [row(1)];
    const next = [row(1), row(2)];
    const merged = mergeRowsPreservingIdentity(prev, next);
    expect(merged[0]).toBe(prev[0]); // reused
    expect(merged[1]).toBe(next[1]); // new row_index -> new
  });

  it("drops a removed row_index (absent from the merged array)", () => {
    const prev = [row(1), row(2)];
    const next = [row(1)]; // row 2 removed
    const merged = mergeRowsPreservingIdentity(prev, next);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toBe(prev[0]);
  });

  it("empty prior -> returns next as-is (all new)", () => {
    const next = [row(1), row(2)];
    expect(mergeRowsPreservingIdentity([], next)).toBe(next);
  });

  it("empty next -> returns next as-is", () => {
    const prev = [row(1)];
    const next: PricedRow[] = [];
    expect(mergeRowsPreservingIdentity(prev, next)).toBe(next);
  });

  it("matches by row_index, NOT array position", () => {
    // row 2 moved to position 0 but is unchanged -> must still be reused.
    const prev = [row(1, { rate_combined: 1 }), row(2, { rate_combined: 2 })];
    const next = [row(2, { rate_combined: 2 }), row(1, { rate_combined: 1 })];
    const merged = mergeRowsPreservingIdentity(prev, next);
    expect(merged[0]).toBe(prev[1]); // row 2 reused at new position
    expect(merged[1]).toBe(prev[0]); // row 1 reused at new position
  });
});
