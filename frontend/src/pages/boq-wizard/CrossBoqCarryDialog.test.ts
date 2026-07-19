// Unit tests for the cross-BOQ rate-carry dialog's PURE helpers (S10 / #1106, ADR-0014 D9):
// the sheet-qualified per-cell key, the writable predicate, the default selection (writable cells
// of UNBLOCKED sheets pre-ticked, conflicts default KEEP), per-sheet bulk overwrite/keep, the
// per-sheet decision-payload builder (destination-keyed, empty sheets omitted), and the whole-BOQ
// plan rollup. No DOM.
import { describe, it, expect } from "vitest";
import {
  cellKey,
  isWritable,
  initialSelection,
  applyBulkOverwrite,
  buildDecisionsBySheet,
  planTotals,
  sheetCountsDisplay,
  sheetWritableKeys,
} from "./CrossBoqCarryDialog";
import type { CrossBoqCarryDecision, CrossBoqCarryPlanRow, CrossBoqCarrySheet } from "./boqTypes";

function row(over: Partial<CrossBoqCarryPlanRow> = {}): CrossBoqCarryPlanRow {
  return {
    source_excel_row: 5,
    dest_excel_row: 10,
    description: "Item",
    dest_description: "Item (revised)",
    source_rate: 100,
    area: null,
    rate_kind: "combined_rate",
    source_boq: "BOQ-26-00001",
    source_version: 1,
    outcome: 2,
    skip_reason: null,
    target_col_letter: "D",
    current_rate: null,
    reason: null,
    ...over,
  };
}

function sheet(over: Partial<CrossBoqCarrySheet> = {}): CrossBoqCarrySheet {
  return {
    sheet_name: "Electrical",
    source_sheet_name: "Electrical",
    source_version: 1,
    dest_version: 1,
    plan: [],
    counts: { clean: 0, conflict: 0, removed: 0, ambiguous: 0, no_rate_column: 0, non_priceable: 0 },
    formulas_complete: true,
    needs_new_value_count: 0,
    ...over,
  };
}

// Electrical: unblocked. 3 clean (one plain + a per-area pair on the same dest row), 1 conflict,
// 1 removed skip (dest null), 1 no_rate_column skip (dest set). Plumbing: BLOCKED (formulas not
// complete). 1 clean + 1 conflict -- none should pre-tick.
const ELECTRICAL = sheet({
  sheet_name: "Electrical",
  needs_new_value_count: 5,
  counts: { clean: 3, conflict: 1, removed: 1, ambiguous: 0, no_rate_column: 1, non_priceable: 0 },
  plan: [
    row({ source_excel_row: 5, dest_excel_row: 10, outcome: 2 }), // clean
    row({ source_excel_row: 6, dest_excel_row: 11, outcome: 3, current_rate: 999 }), // conflict
    row({ source_excel_row: 7, dest_excel_row: null, outcome: 1, skip_reason: "removed", target_col_letter: null, reason: "gone" }),
    row({ source_excel_row: 8, dest_excel_row: 13, outcome: 1, skip_reason: "no_rate_column", target_col_letter: null, reason: "no col" }),
    row({ source_excel_row: 9, dest_excel_row: 14, outcome: 2, area: "Phase 1" }), // per-area clean
    row({ source_excel_row: 9, dest_excel_row: 14, outcome: 2, area: "Phase 2" }), // per-area clean (same dest row)
  ],
});
const PLUMBING = sheet({
  sheet_name: "Plumbing",
  formulas_complete: false,
  needs_new_value_count: 0,
  counts: { clean: 1, conflict: 1, removed: 0, ambiguous: 0, no_rate_column: 0, non_priceable: 0 },
  plan: [
    row({ source_excel_row: 20, dest_excel_row: 120, outcome: 2 }),
    row({ source_excel_row: 21, dest_excel_row: 121, outcome: 3, current_rate: 500 }),
  ],
});
const SHEETS = [ELECTRICAL, PLUMBING];

describe("cellKey", () => {
  it("is a stable string carrying the sheet, dest row, and rate kind", () => {
    const k = cellKey("Electrical", { dest_excel_row: 10, area: null, rate_kind: "combined_rate" });
    expect(k).toContain("Electrical");
    expect(k).toContain("10");
    expect(k).toContain("combined_rate");
  });
  it("distinguishes null area from a present area on the same dest cell", () => {
    const a = cellKey("Electrical", { dest_excel_row: 10, area: null, rate_kind: "combined_rate" });
    const b = cellKey("Electrical", { dest_excel_row: 10, area: "Phase 1", rate_kind: "combined_rate" });
    expect(a).not.toBe(b);
  });
  it("distinguishes the two per-area cells on the same dest row", () => {
    const k1 = cellKey("Electrical", { dest_excel_row: 14, area: "Phase 1", rate_kind: "combined_rate" });
    const k2 = cellKey("Electrical", { dest_excel_row: 14, area: "Phase 2", rate_kind: "combined_rate" });
    expect(k1).not.toBe(k2);
  });
  it("distinguishes the same dest row across two sheets", () => {
    const a = cellKey("Electrical", { dest_excel_row: 10, area: null, rate_kind: "combined_rate" });
    const b = cellKey("Plumbing", { dest_excel_row: 10, area: null, rate_kind: "combined_rate" });
    expect(a).not.toBe(b);
  });
});

describe("isWritable", () => {
  it("is true for clean (2) and conflict (3), false for a hard skip (1)", () => {
    expect(isWritable(row({ outcome: 2 }))).toBe(true);
    expect(isWritable(row({ outcome: 3 }))).toBe(true);
    expect(isWritable(row({ outcome: 1, skip_reason: "removed" }))).toBe(false);
  });
});

describe("initialSelection", () => {
  it("pre-ticks every writable cell of UNBLOCKED sheets, conflicts default KEEP", () => {
    const { selected, overwrite } = initialSelection(SHEETS);
    // Electrical: 3 clean + 1 conflict = 4 writable. Plumbing blocked -> 0.
    expect(selected.size).toBe(4);
    expect(selected.has(cellKey("Electrical", { dest_excel_row: 10, area: null, rate_kind: "combined_rate" }))).toBe(true);
    expect(selected.has(cellKey("Electrical", { dest_excel_row: 14, area: "Phase 1", rate_kind: "combined_rate" }))).toBe(true);
    // the conflict is selected AND defaults to keep (overwrite=false)
    const conflictKey = cellKey("Electrical", { dest_excel_row: 11, area: null, rate_kind: "combined_rate" });
    expect(selected.has(conflictKey)).toBe(true);
    expect(overwrite[conflictKey]).toBe(false);
  });
  it("never pre-ticks a blocked sheet's cells", () => {
    const { selected } = initialSelection(SHEETS);
    expect(selected.has(cellKey("Plumbing", { dest_excel_row: 120, area: null, rate_kind: "combined_rate" }))).toBe(false);
    expect(selected.has(cellKey("Plumbing", { dest_excel_row: 121, area: null, rate_kind: "combined_rate" }))).toBe(false);
  });
});

describe("buildDecisionsBySheet", () => {
  it("emits per-sheet destination-keyed decisions; omits sheets with no selection", () => {
    const { selected, overwrite } = initialSelection(SHEETS);
    const out = buildDecisionsBySheet(SHEETS, selected, overwrite);
    expect(Object.keys(out)).toEqual(["Electrical"]); // Plumbing blocked -> nothing selected -> omitted
    expect(out.Electrical).toHaveLength(4);
    const conflict = out.Electrical.find((d: CrossBoqCarryDecision) => d.dest_excel_row === 11);
    expect(conflict).toEqual({ dest_excel_row: 11, area: null, rate_kind: "combined_rate", overwrite: false });
    const perArea = out.Electrical.filter((d: CrossBoqCarryDecision) => d.dest_excel_row === 14);
    expect(perArea.map((d: CrossBoqCarryDecision) => d.area).sort()).toEqual(["Phase 1", "Phase 2"]);
  });
  it("honours a bulk-overwrite patch on the conflict only", () => {
    const { selected } = initialSelection(SHEETS);
    const overwrite = applyBulkOverwrite(ELECTRICAL, true);
    const out = buildDecisionsBySheet(SHEETS, selected, overwrite);
    expect(out.Electrical.find((d: CrossBoqCarryDecision) => d.dest_excel_row === 11)?.overwrite).toBe(true);
    // a clean row is always overwrite:false regardless of the patch
    expect(out.Electrical.find((d: CrossBoqCarryDecision) => d.dest_excel_row === 10)?.overwrite).toBe(false);
  });
  it("drops a deselected cell", () => {
    const { selected, overwrite } = initialSelection(SHEETS);
    selected.delete(cellKey("Electrical", { dest_excel_row: 10, area: null, rate_kind: "combined_rate" }));
    const out = buildDecisionsBySheet(SHEETS, selected, overwrite);
    expect(out.Electrical.find((d: CrossBoqCarryDecision) => d.dest_excel_row === 10)).toBeUndefined();
    expect(out.Electrical).toHaveLength(3);
  });
});

describe("applyBulkOverwrite", () => {
  it("returns only the conflict keys, set to the given value", () => {
    expect(applyBulkOverwrite(ELECTRICAL, true)).toEqual({
      [cellKey("Electrical", { dest_excel_row: 11, area: null, rate_kind: "combined_rate" })]: true,
    });
    expect(applyBulkOverwrite(ELECTRICAL, false)).toEqual({
      [cellKey("Electrical", { dest_excel_row: 11, area: null, rate_kind: "combined_rate" })]: false,
    });
  });
});

describe("planTotals", () => {
  it("rolls the whole-BOQ plan up", () => {
    const t = planTotals(SHEETS);
    expect(t.cleanCells).toBe(4); // 3 Electrical + 1 Plumbing
    expect(t.conflictCells).toBe(2); // 1 + 1
    expect(t.writableCells).toBe(6);
    expect(t.skipCells).toBe(2); // Electrical removed + no_rate_column
    expect(t.needsNewValues).toBe(5);
    expect(t.blockedSheets).toEqual(["Plumbing"]);
    expect(t.totalSheets).toBe(2);
  });
});

describe("sheetCountsDisplay", () => {
  it("splits into copy / conflicts / skipped", () => {
    expect(sheetCountsDisplay(ELECTRICAL)).toEqual({ copy: 3, conflicts: 1, skipped: 2 });
    expect(sheetCountsDisplay(PLUMBING)).toEqual({ copy: 1, conflicts: 1, skipped: 0 });
  });
});

describe("sheetWritableKeys", () => {
  it("lists the writable cell keys for a sheet (drives the sheet-level tick)", () => {
    expect(sheetWritableKeys(ELECTRICAL)).toHaveLength(4);
    expect(sheetWritableKeys(PLUMBING)).toHaveLength(2);
  });
});
