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
  carryButtonState,
  CARRY_DISABLED_REASON,
  armedRateOverwrites,
  summarizeSheetCarry,
} from "./CrossBoqCarryDialog";
import type {
  ApplySheetCarryResponse,
  CrossBoqCarryDecision,
  CrossBoqCarryPlanRow,
  CrossBoqCarrySheet,
} from "./boqTypes";

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
    counts: { clean: 0, conflict: 0, removed: 0, no_rate_column: 0, non_priceable: 0 },
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
  counts: { clean: 3, conflict: 1, removed: 1, no_rate_column: 1, non_priceable: 0 },
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
  counts: { clean: 1, conflict: 1, removed: 0, no_rate_column: 0, non_priceable: 0 },
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

// ── AMENDMENT C / C3: the pricing-screen button's state ────────────────────────────
describe("carryButtonState (the pricing-screen button)", () => {
  const base = {
    isRevisionSheet: true,
    loading: false,
    locked: false,
    formulasComplete: true,
    sheet: sheet({ counts: { clean: 2, conflict: 1, removed: 0, no_rate_column: 0, non_priceable: 0 } }),
  };

  it("is HIDDEN off a revision -- the action does not exist, so a disabled button would lie", () => {
    expect(carryButtonState({ ...base, isRevisionSheet: false }).kind).toBe("hidden");
  });

  it("hides off a revision even while loading (the hidden check wins)", () => {
    expect(carryButtonState({ ...base, isRevisionSheet: false, loading: true }).kind).toBe("hidden");
  });

  it("is disabled while the plan is loading", () => {
    const s = carryButtonState({ ...base, loading: true });
    expect(s).toEqual({ kind: "disabled", reason: CARRY_DISABLED_REASON.loading });
  });

  it("is disabled with 'nothing to carry' when the sheet has no plan entry (no mapped source)", () => {
    const s = carryButtonState({ ...base, sheet: null });
    expect(s).toEqual({ kind: "disabled", reason: CARRY_DISABLED_REASON.nothing });
  });

  it("reports LOCKED ahead of the formula gate -- no write of any kind can land", () => {
    const s = carryButtonState({ ...base, locked: true, formulasComplete: false });
    expect(s).toEqual({ kind: "disabled", reason: CARRY_DISABLED_REASON.locked });
  });

  it("is disabled on the mandatory amount-formula gate", () => {
    const s = carryButtonState({ ...base, formulasComplete: false });
    expect(s).toEqual({ kind: "disabled", reason: CARRY_DISABLED_REASON.formulas });
  });

  it("is READY on rates, counting clean + conflict", () => {
    expect(carryButtonState(base)).toEqual({ kind: "ready", rateCells: 3 });
  });

  it("counts a CONFLICT as work -- overwriting an existing rate is a real action", () => {
    const s = carryButtonState({
      ...base,
      sheet: sheet({ counts: { clean: 0, conflict: 5, removed: 0, no_rate_column: 0, non_priceable: 0 } }),
    });
    expect(s).toEqual({ kind: "ready", rateCells: 5 });
  });

  it("is disabled when no rate cell is carryable", () => {
    const s = carryButtonState({
      ...base,
      sheet: sheet({
        counts: { clean: 0, conflict: 0, removed: 4, no_rate_column: 2, non_priceable: 1 },
      }),
    });
    expect(s).toEqual({ kind: "disabled", reason: CARRY_DISABLED_REASON.nothing });
  });

  // AMENDMENT D: the annotation carry is GONE, so annotations no longer make the button ready.
  // Before D, a sheet with 0 carryable rates but N carryable remarks opened the dialog.
  it("AMENDMENT D: a sheet whose only carryable content was annotations is 'nothing to carry'", () => {
    const s = carryButtonState({
      ...base,
      sheet: sheet({
        counts: { clean: 0, conflict: 0, removed: 0, no_rate_column: 0, non_priceable: 0 },
      }),
    });
    expect(s).toEqual({ kind: "disabled", reason: CARRY_DISABLED_REASON.nothing });
  });
});

// ── AMENDMENT D: the destructive footer now reports armed RATE overwrites ──────────
describe("armedRateOverwrites (the destructive footer)", () => {
  const conflictSheet = sheet({
    sheet_name: "S1",
    plan: [
      row({ dest_excel_row: 10, outcome: 3 }),
      row({ dest_excel_row: 11, outcome: 3 }),
      row({ dest_excel_row: 12, outcome: 2 }),
      row({ dest_excel_row: 13, outcome: 1, skip_reason: "removed" }),
    ],
  });
  // MUST mirror row()'s defaults -- rate_kind is "combined_rate", not "rate".
  const k = (r: number) =>
    cellKey("S1", { dest_excel_row: r, area: null, rate_kind: "combined_rate" });

  it("is 0 with no sheet", () => {
    expect(armedRateOverwrites(null, new Set(), {})).toBe(0);
  });

  it("counts only SELECTED conflicts with overwrite armed", () => {
    const selected = new Set([k(10), k(11), k(12)]);
    expect(armedRateOverwrites(conflictSheet, selected, { [k(10)]: true, [k(11)]: false })).toBe(1);
  });

  it("ignores an armed overwrite on an UNSELECTED conflict -- it will not be written", () => {
    expect(armedRateOverwrites(conflictSheet, new Set([k(11)]), { [k(10)]: true })).toBe(0);
  });

  it("never counts a clean copy or a hard skip -- neither replaces anything", () => {
    const selected = new Set([k(12), k(13)]);
    expect(armedRateOverwrites(conflictSheet, selected, { [k(12)]: true, [k(13)]: true })).toBe(0);
  });

  it("counts every armed conflict when the user bulk-overwrites", () => {
    const selected = new Set([k(10), k(11), k(12)]);
    expect(armedRateOverwrites(conflictSheet, selected, { [k(10)]: true, [k(11)]: true })).toBe(2);
  });
});

describe("summarizeSheetCarry (the post-apply line)", () => {
  const res = (over: Partial<ApplySheetCarryResponse> = {}): ApplySheetCarryResponse => ({
    ok: true, copied: 0, conflicts_overwritten: 0, conflicts_kept: 0, skipped: {},
    ...over,
  });

  it("counts a clean copy and an overwrite as both landed", () => {
    expect(summarizeSheetCarry(res({ copied: 10, conflicts_overwritten: 2 }), 0))
      .toBe("Carried 12 rates.");
  });

  // AMENDMENT D: the line used to append "and N items" for the annotation layers. The carry
  // moves rates only, so the sentence is rates-only too.
  it("reports rates alone -- there is no annotation total to append", () => {
    expect(summarizeSheetCarry(res({ copied: 5 }), 0)).toBe("Carried 5 rates.");
  });

  it("uses the singular for exactly one rate", () => {
    expect(summarizeSheetCarry(res({ copied: 1 }), 0)).toBe("Carried 1 rate.");
  });

  it("reports what was deliberately left alone", () => {
    expect(summarizeSheetCarry(res({ copied: 1, conflicts_kept: 3 }), 0))
      .toBe("Carried 1 rate. 3 existing rates left as they were.");
  });

  it("points at the Show-unpriced filter for rows the carry could never help", () => {
    expect(summarizeSheetCarry(res({ copied: 1 }), 2))
      .toContain("2 rows still need a rate");
  });

  it("says so plainly when nothing landed", () => {
    expect(summarizeSheetCarry(res(), 0)).toBe("Nothing was carried.");
  });

  it("survives a missing payload", () => {
    expect(summarizeSheetCarry(undefined, 0)).toBe("Nothing was carried.");
  });
});
