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
  carryLayerItemTotal,
  CARRY_DISABLED_REASON,
  layerCountsLine,
  layerRowStates,
  initialLayerChoices,
  buildLayersPayload,
  armedOverwrites,
  applyTotals,
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
  const LAYERS_EMPTY = {
    remarks: { carryable: 0, present: 0, unmatched: 0, dropped: 0 },
    colors: { carryable: 0, present: 0, unmatched: 0, dropped: 0 },
    remark_dismissals: { carryable: 0, present: 0, unmatched: 0, dropped: 0 },
    categories: { carryable: 0, present: 0, unmatched: 0, dropped: 0 },
  };
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

  it("is disabled when nothing is carryable on either axis", () => {
    const s = carryButtonState({
      ...base,
      sheet: sheet({
        counts: { clean: 0, conflict: 0, removed: 4, no_rate_column: 2, non_priceable: 1 },
        layers: LAYERS_EMPTY,
      }),
    });
    expect(s).toEqual({ kind: "disabled", reason: CARRY_DISABLED_REASON.nothing });
  });

  it("is READY on rates alone, counting clean + conflict", () => {
    expect(carryButtonState(base)).toEqual({ kind: "ready", rateCells: 3, layerItems: 0 });
  });

  it("is READY on annotations alone -- a sheet with no carryable rate still opens", () => {
    const s = carryButtonState({
      ...base,
      sheet: sheet({
        counts: { clean: 0, conflict: 0, removed: 0, no_rate_column: 0, non_priceable: 0 },
        layers: { ...LAYERS_EMPTY, remarks: { carryable: 4, present: 0, unmatched: 2, dropped: 0 } },
      }),
    });
    expect(s).toEqual({ kind: "ready", rateCells: 0, layerItems: 4 });
  });

  it("counts an ALREADY-PRESENT annotation as work -- overwrite is a real action", () => {
    const s = carryButtonState({
      ...base,
      sheet: sheet({
        counts: { clean: 0, conflict: 0, removed: 0, no_rate_column: 0, non_priceable: 0 },
        layers: { ...LAYERS_EMPTY, categories: { carryable: 0, present: 12, unmatched: 0, dropped: 0 } },
      }),
    });
    expect(s).toEqual({ kind: "ready", rateCells: 0, layerItems: 12 });
  });

  it("excludes unmatched / dropped -- they can never land", () => {
    expect(
      carryLayerItemTotal(
        sheet({
          layers: {
            ...LAYERS_EMPTY,
            colors: { carryable: 1, present: 2, unmatched: 9, dropped: 7 },
          },
        }),
      ),
    ).toBe(3);
  });

  it("tolerates a pre-Amendment-C payload with no layers block", () => {
    expect(carryLayerItemTotal(sheet())).toBe(0);
    expect(carryButtonState(base).kind).toBe("ready");
  });
});

// ── AMENDMENT C / C4: the annotation-layer block ───────────────────────────────────
const L0 = { carryable: 0, present: 0, unmatched: 0, dropped: 0 };
const layers = (over: Partial<Record<string, typeof L0>> = {}) => ({
  remarks: L0, colors: L0, remark_dismissals: L0, categories: L0, ...over,
}) as NonNullable<CrossBoqCarrySheet["layers"]>;

describe("layerCountsLine (the counts line IS the outcome preview)", () => {
  it("reads 'nothing to carry' when the layer is empty", () => {
    expect(layerCountsLine(L0, false)).toEqual({
      lead: "nothing to carry", conflict: null, conflictIsDestructive: false, trailing: [],
    });
  });

  it("swaps kept <-> replaced with the toggle, in place", () => {
    const counts = { carryable: 12, present: 3, unmatched: 0, dropped: 0 };
    expect(layerCountsLine(counts, false).conflict).toBe("3 kept");
    expect(layerCountsLine(counts, false).conflictIsDestructive).toBe(false);
    expect(layerCountsLine(counts, true).conflict).toBe("3 replaced");
    expect(layerCountsLine(counts, true).conflictIsDestructive).toBe(true);
  });

  it("makes an all-conflicts layer on Keep visibly a no-op", () => {
    // THE failure mode this line exists to close: 0 clean + N conflicts set to Keep changes
    // nothing, and without the preview the row still looks armed.
    const line = layerCountsLine({ carryable: 0, present: 340, unmatched: 0, dropped: 0 }, false);
    expect(line.lead).toBe("0 to copy");
    expect(line.conflict).toBe("340 kept");
  });

  it("appends unmatched and column-gone only when non-zero", () => {
    expect(layerCountsLine({ carryable: 1, present: 0, unmatched: 2, dropped: 3 }, false).trailing)
      .toEqual(["2 unmatched", "3 column gone"]);
    expect(layerCountsLine({ carryable: 1, present: 0, unmatched: 0, dropped: 0 }, false).trailing)
      .toEqual([]);
  });
});

describe("layerRowStates", () => {
  it("hides the Keep/Overwrite toggle when there is no conflict to decide", () => {
    const rows = layerRowStates(sheet({ layers: layers({ remarks: { carryable: 5, present: 0, unmatched: 0, dropped: 0 } }) }));
    expect(rows.find((r) => r.key === "remarks")!.showToggle).toBe(false);
  });

  it("shows the toggle exactly when something is already present", () => {
    const rows = layerRowStates(sheet({ layers: layers({ remarks: { carryable: 5, present: 2, unmatched: 0, dropped: 0 } }) }));
    const r = rows.find((x) => x.key === "remarks")!;
    expect(r.showToggle).toBe(true);
    expect(r.presentLabel).toBe("2 rows already have a remark");
  });

  it("disables an empty layer", () => {
    expect(layerRowStates(sheet({ layers: layers() })).every((r) => r.disabled)).toBe(true);
  });

  it("blocks CATEGORIES on a classification freeze and leaves the others alone", () => {
    const full = { carryable: 3, present: 1, unmatched: 0, dropped: 0 };
    const rows = layerRowStates(
      sheet({ layers: layers({ categories: full, remarks: full }) }),
      { classificationFrozen: true },
    );
    const cat = rows.find((r) => r.key === "categories")!;
    const rem = rows.find((r) => r.key === "remarks")!;
    expect(cat.disabled).toBe(true);
    expect(cat.blockedNote).toMatch(/frozen/i);
    expect(cat.showToggle).toBe(false);
    expect(rem.disabled).toBe(false);
    expect(rem.blockedNote).toBeNull();
  });

  it("tolerates a pre-Amendment-C payload with no layers block", () => {
    expect(layerRowStates(sheet()).every((r) => r.disabled)).toBe(true);
  });
});

describe("initialLayerChoices / buildLayersPayload", () => {
  const S = sheet({
    layers: layers({
      remarks: { carryable: 4, present: 2, unmatched: 0, dropped: 0 },
      categories: { carryable: 9, present: 0, unmatched: 0, dropped: 0 },
    }),
  });

  it("carries every non-empty layer by default, with conflicts on KEEP", () => {
    const c = initialLayerChoices(S);
    expect(c.remarks).toEqual({ carry: true, overwrite: false });
    expect(c.categories).toEqual({ carry: true, overwrite: false });
    expect(c.colors).toEqual({ carry: false, overwrite: false });
  });

  it("starts a frozen category layer OFF", () => {
    expect(initialLayerChoices(S, { classificationFrozen: true }).categories.carry).toBe(false);
  });

  it("force-clears a blocked layer in the payload even if the choice says carry", () => {
    const stale = { ...initialLayerChoices(S), categories: { carry: true, overwrite: true } };
    const payload = buildLayersPayload(S, stale, { classificationFrozen: true });
    expect(payload.categories).toEqual({ carry: false, overwrite: false });
    expect(payload.remarks.carry).toBe(true);
  });
});

describe("armedOverwrites (the destructive footer)", () => {
  const S = sheet({
    layers: layers({
      remarks: { carryable: 4, present: 3, unmatched: 0, dropped: 0 },
      categories: { carryable: 0, present: 340, unmatched: 0, dropped: 0 },
    }),
  });

  it("is empty while everything is on Keep", () => {
    expect(armedOverwrites(S, initialLayerChoices(S))).toEqual([]);
  });

  it("lists only the layers whose overwrite will actually replace something", () => {
    const c = {
      ...initialLayerChoices(S),
      remarks: { carry: true, overwrite: true },
      categories: { carry: true, overwrite: true },
      colors: { carry: true, overwrite: true }, // nothing present -> not armed
    };
    expect(armedOverwrites(S, c)).toEqual([
      { key: "remarks", label: "remarks", count: 3 },
      { key: "categories", label: "categories", count: 340 },
    ]);
  });

  it("uses the SINGULAR noun at a count of one -- the footer always states a count", () => {
    // Found in live E2E: the footer read "Overwriting 1 remarks".
    const one = sheet({
      layers: layers({ remarks: { carryable: 0, present: 1, unmatched: 0, dropped: 0 } }),
    });
    const c = { ...initialLayerChoices(one), remarks: { carry: true, overwrite: true } };
    expect(armedOverwrites(one, c)).toEqual([{ key: "remarks", label: "remark", count: 1 }]);
  });

  it("ignores an overwrite on a layer that is not being carried", () => {
    const c = { ...initialLayerChoices(S), remarks: { carry: false, overwrite: true } };
    expect(armedOverwrites(S, c).map((a) => a.key)).toEqual([]);
  });
});

describe("applyTotals (the primary button's numbers)", () => {
  const S = sheet({
    layers: layers({
      remarks: { carryable: 4, present: 3, unmatched: 9, dropped: 2 },
      categories: { carryable: 10, present: 0, unmatched: 0, dropped: 0 },
    }),
  });

  it("counts carryable items, and present ones only when overwrite is armed", () => {
    expect(applyTotals(S, 47, initialLayerChoices(S))).toEqual({ rates: 47, items: 14 });
    const armedC = { ...initialLayerChoices(S), remarks: { carry: true, overwrite: true } };
    expect(applyTotals(S, 47, armedC)).toEqual({ rates: 47, items: 17 });
  });

  it("excludes an unticked layer entirely", () => {
    const c = { ...initialLayerChoices(S), categories: { carry: false, overwrite: false } };
    expect(applyTotals(S, 0, c)).toEqual({ rates: 0, items: 4 });
  });
});

describe("summarizeSheetCarry (the post-apply line)", () => {
  const res = (over: Partial<ApplySheetCarryResponse> = {}): ApplySheetCarryResponse => ({
    ok: true, copied: 0, conflicts_overwritten: 0, conflicts_kept: 0, skipped: {}, layers: {},
    ...over,
  });

  it("counts a clean copy and an overwrite as both landed", () => {
    expect(summarizeSheetCarry(res({ copied: 10, conflicts_overwritten: 2 }), 0))
      .toBe("Carried 12 rates.");
  });

  it("adds the layer items that landed", () => {
    const s = res({
      copied: 5,
      layers: { remarks: { carried: 3, replaced: 1, kept: 9, unmatched: 0, dropped: 0 } },
    });
    expect(summarizeSheetCarry(s, 0)).toBe("Carried 5 rates and 4 items.");
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
