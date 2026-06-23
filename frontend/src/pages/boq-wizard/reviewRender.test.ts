// Characterization tests for the shared review-render helpers (BoQ Phase 5 Slice 2).
//
// These tests pin the CURRENT behavior of the three pure render helpers as a golden
// baseline, so the Slice-2 extraction (moving them out of ReviewTree.tsx into
// reviewRender.ts) is provably behavior-preserving: the SAME assertions must pass
// before AND after the move. The golden values were captured from the actual current
// output, not invented.
//
// Import home: ./reviewRender (the extracted module). During Slice-2 Step 1 these were
// imported from ./ReviewTree (verified GREEN in place); Step 2 re-pointed the import to
// ./reviewRender and re-ran GREEN -- that pre/post parity is the extraction proof.
//
// ClassificationPill is intentionally NOT unit-tested here: it returns JSX and asserting
// it would require jsdom / @testing-library, which this harness deliberately does not add.
// The pill is covered by the manual live-cert (visual eyeball of the review screen).
import { describe, it, expect } from "vitest";
import {
  computeDepths,
  resolveDescriptorValue,
  renderDescriptorCell,
} from "./reviewRender";
import type { ReviewRow, ColumnDescriptor } from "./boqTypes";

// Minimal row fixtures -- computeDepths reads only row_index + effective_parent_index;
// the rest of ReviewRow is irrelevant to these helpers, so we cast narrow objects.
function row(row_index: number, effective_parent_index: number | null): ReviewRow {
  return { row_index, effective_parent_index } as unknown as ReviewRow;
}

function desc(
  value_field: string,
  value_key: string | null,
  rate_subkey: string | null,
): ColumnDescriptor {
  return { col: "X", role: "r", area: value_key, value_field, value_key, rate_subkey };
}

describe("computeDepths", () => {
  it("assigns root depth 0 and increments per child level (nested chain)", () => {
    const rows = [
      row(0, null), // root
      row(1, 0), // child of 0
      row(2, 1), // grandchild
    ];
    const depths = computeDepths(rows);
    expect(depths.get(0)).toBe(0);
    expect(depths.get(1)).toBe(1);
    expect(depths.get(2)).toBe(2);
  });

  it("hangs a row off a missing parent one level below it (phantom parent is the root)", () => {
    // Captured CURRENT behavior: the absent parent (99) is walked as the depth-0 root,
    // so the orphan row sits at depth 1 -- NOT collapsed to 0.
    const depths = computeDepths([row(3, 99)]); // parent 99 not present
    expect(depths.get(3)).toBe(1);
  });

  it("assigns depth 0 to every member of a parent cycle", () => {
    const depths = computeDepths([row(4, 5), row(5, 4)]); // 4 <-> 5 cycle
    expect(depths.get(4)).toBe(0);
    expect(depths.get(5)).toBe(0);
  });
});

describe("resolveDescriptorValue", () => {
  const r = {
    qty_total: 220,
    rate_by_area: { "Phase 1": { combined_rate: 150 } },
    make_model: null,
  } as unknown as ReviewRow;

  it("returns the flat field for a scalar descriptor (value_key null)", () => {
    expect(resolveDescriptorValue(r, desc("qty_total", null, null))).toBe(220);
  });

  it("walks the nested per-area path (value_field -> area -> rate kind)", () => {
    expect(
      resolveDescriptorValue(r, desc("rate_by_area", "Phase 1", "combined_rate")),
    ).toBe(150);
  });

  it("returns undefined for a missing per-area key", () => {
    expect(
      resolveDescriptorValue(r, desc("rate_by_area", "Phase 99", "combined_rate")),
    ).toBeUndefined();
  });

  it("returns undefined when the top-level field is null", () => {
    expect(resolveDescriptorValue(r, desc("make_model", null, null))).toBeUndefined();
  });
});

describe("renderDescriptorCell", () => {
  it("renders null and undefined as a blank string", () => {
    expect(renderDescriptorCell(null)).toBe("");
    expect(renderDescriptorCell(undefined)).toBe("");
  });

  it("renders an integer with no decimals", () => {
    expect(renderDescriptorCell(220)).toBe("220");
  });

  it("renders a decimal via fmtNum (trailing zeros stripped)", () => {
    expect(renderDescriptorCell(150.5)).toBe("150.5");
  });

  it("renders zero as '0' (absent-vs-zero rule)", () => {
    expect(renderDescriptorCell(0)).toBe("0");
  });

  it("renders a string verbatim via String()", () => {
    expect(renderDescriptorCell("Mtr")).toBe("Mtr");
  });
});
