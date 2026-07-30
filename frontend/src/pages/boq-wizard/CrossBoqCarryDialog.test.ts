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
  rateWriteCount,
  rateWriteCountAll,
} from "./CrossBoqCarryDialog";
// WBC-W1-S1: the layer-choice block + its pure helpers moved to the shared CarryLayers module so a
// second carry surface (the within-BoQ CopyForwardDialog) can reuse them. Import paths only -- every
// assertion below is unchanged, which is what makes this suite the proof the move changed nothing.
import {
  CARRY_DESTINATION_CROSS_BOQ,
  LAYER_LABEL,
  carryWriteCount,
  initialLayerChoices,
  layerHint,
  layerOutcomeFor,
  layerHasWork,
  layerMoveCount,
  layerCountsText,
  layerSkipNote,
  armedLayerReplacements,
  buildLayersPayload,
  nothingToCarry,
  carrySelectionSummary,
  type LayerChoices,
} from "./CarryLayers";
import { CARRY_LAYER_KEYS } from "./boqTypes";
import type {
  ApplySheetCarryResponse,
  CarryLayerOutcome,
  CrossBoqCarryDecision,
  CrossBoqCarryPlanRow,
  CrossBoqCarrySheet,
} from "./boqTypes";

/** A planned layer outcome. Every field defaults to 0 so a test names only what it is about. */
function outcome(over: Partial<CarryLayerOutcome> = {}): CarryLayerOutcome {
  return { carried: 0, replaced: 0, kept: 0, unmatched: 0, ineligible: 0, dropped: 0, ...over };
}

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

/** Code point 0, named explicitly rather than typed as a raw byte -- writing a literal NUL
 *  into a source file is exactly the defect these tests pin (see the two cases below). */
const NUL = String.fromCharCode(0);

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

  // ── WBC-S3a: the NUL separator, pinned byte for byte ──────────────────────────────
  // The separator was written as a RAW NUL BYTE in the source, which made git classify the whole
  // file as binary (`git diff --stat` reported 0 insertions / 0 deletions) and made an un-`-a`'d
  // grep skip it silently. Replacing that byte with the `\0` ESCAPE is a source-text change with no
  // runtime meaning -- these two cases assert the produced key against independently written
  // literals, so they are green on BOTH sides of that edit and would fail loudly if the byte were
  // STRIPPED instead of escaped (the fix a reviewer first suggested and then withdrew).
  it("separates the sheet from the dest row with a NUL, byte for byte", () => {
    const k = cellKey("Electrical", { dest_excel_row: 10, area: null, rate_kind: "combined_rate" });
    expect(k).toBe(`Electrical${NUL}10||combined_rate`);
    expect(k.charCodeAt("Electrical".length)).toBe(0);
  });

  // Why the separator has to be there at all: strip it and "S" + 110 becomes "S1" + 10, so two
  // sheets whose names differ by a trailing digit would silently share one cell key -- the same
  // decision would be applied to the wrong sheet's row.
  it("does not collide when one sheet name is another plus a digit", () => {
    const a = cellKey("S", { dest_excel_row: 110, area: null, rate_kind: "combined_rate" });
    const b = cellKey("S1", { dest_excel_row: 10, area: null, rate_kind: "combined_rate" });
    expect(a).not.toBe(b);
    // ... and the collision is EXACTLY what the separator prevents.
    expect(a.replace(NUL, "")).toBe(b.replace(NUL, ""));
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
    ok: true, copied: 0, conflicts_overwritten: 0, conflicts_kept: 0, skipped: {}, layers: {},
    ...over,
  });

  it("counts a clean copy and an overwrite as both landed", () => {
    expect(summarizeSheetCarry(res({ copied: 10, conflicts_overwritten: 2 }), 0))
      .toBe("Carried 12 rates.");
  });

  // AMENDMENT E: a layer that did not run is ABSENT from `layers`, so the sentence stays
  // rates-only -- which is also exactly what a pre-E client keeps getting.
  it("reports rates alone when no layer ran", () => {
    expect(summarizeSheetCarry(res({ copied: 5 }), 0)).toBe("Carried 5 rates.");
  });

  it("names each layer that landed something, alongside the rates", () => {
    expect(
      summarizeSheetCarry(
        res({ copied: 5, layers: { categories: outcome({ carried: 140, replaced: 3 }) } }),
        0,
      ),
    ).toBe("Carried 5 rates and 143 categories.");
  });

  it("joins three landed axes the way a person would", () => {
    expect(
      summarizeSheetCarry(
        res({
          copied: 2,
          layers: {
            categories: outcome({ carried: 10 }),
            remarks: outcome({ carried: 4 }),
          },
        }),
        0,
      ),
    ).toBe("Carried 2 rates, 10 categories and 4 remarks.");
  });

  // The regression this branch exists for: a freshly committed revision whose rates ALL conflict
  // can still take the whole category set. Reporting "Nothing was carried." there is flatly false.
  it("does NOT say 'nothing' when a layer landed but no rate did", () => {
    expect(
      summarizeSheetCarry(res({ layers: { categories: outcome({ carried: 143 }) } }), 0),
    ).toBe("Carried 143 categories.");
  });

  it("ignores a layer that ran but moved nothing", () => {
    expect(
      summarizeSheetCarry(res({ copied: 5, layers: { colors: outcome({ dropped: 9 }) } }), 0),
    ).toBe("Carried 5 rates.");
  });

  it("still says 'nothing' when every axis is empty", () => {
    expect(
      summarizeSheetCarry(res({ layers: { categories: outcome({ unmatched: 12 }) } }), 0),
    ).toBe("Nothing was carried.");
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

// ── AMENDMENT E: the opt-in non-rate layers ────────────────────────────────────────

/** A sheet carrying a planned `layers` block. */
function layered(layers: CrossBoqCarrySheet["layers"]): CrossBoqCarrySheet {
  return sheet({ layers });
}

/** Start from the shipped defaults and override individual layers. */
function choices(over: Partial<LayerChoices> = {}): LayerChoices {
  return { ...initialLayerChoices(), ...over };
}

describe("initialLayerChoices (the shipped defaults)", () => {
  it("ticks CATEGORIES and leaves the three annotation layers off (owner decision 6)", () => {
    const c = initialLayerChoices();
    expect(c.categories).toEqual({ carry: true, overwrite: false });
    expect(c.remarks).toEqual({ carry: false, overwrite: false });
    expect(c.colors).toEqual({ carry: false, overwrite: false });
    expect(c.remark_dismissals).toEqual({ carry: false, overwrite: false });
  });

  it("never defaults ANY layer to overwrite -- Keep is the safe default on every axis", () => {
    for (const key of CARRY_LAYER_KEYS) {
      expect(initialLayerChoices()[key].overwrite).toBe(false);
    }
  });

  it("returns a FRESH object each call, so resetting one dialog cannot mutate another", () => {
    const a = initialLayerChoices();
    a.categories.carry = false;
    expect(initialLayerChoices().categories.carry).toBe(true);
  });

  it("covers every key in CARRY_LAYER_KEYS -- a new layer cannot be silently unhandled", () => {
    const c = initialLayerChoices();
    for (const key of CARRY_LAYER_KEYS) expect(c[key]).toBeDefined();
    expect(Object.keys(c).sort()).toEqual([...CARRY_LAYER_KEYS].sort());
  });
});

describe("layerOutcomeFor / layerHasWork", () => {
  it("reads the planned outcome for a layer", () => {
    const s = layered({ categories: outcome({ carried: 12 }) });
    expect(layerOutcomeFor(s, "categories")?.carried).toBe(12);
  });

  // A pre-Amendment-E server sends no `layers` key at all; the dialog must degrade, not throw.
  it("is null when the server sent no layers block at all", () => {
    expect(layerOutcomeFor(sheet(), "categories")).toBeNull();
    expect(layerOutcomeFor(null, "categories")).toBeNull();
    expect(layerOutcomeFor(undefined, "remarks")).toBeNull();
  });

  it("is null for a layer missing from a block that has other layers", () => {
    expect(layerOutcomeFor(layered({ categories: outcome() }), "colors")).toBeNull();
  });

  it("has work when rows would be WRITTEN", () => {
    expect(layerHasWork(outcome({ carried: 3 }))).toBe(true);
  });

  // `kept` alone is still a real choice: nothing copies, but Overwrite would replace those rows.
  it("has work when rows would only be REPLACED by arming overwrite", () => {
    expect(layerHasWork(outcome({ kept: 4 }))).toBe(true);
  });

  it("has NO work when every destination row is unmatched / ineligible / dropped", () => {
    expect(layerHasWork(outcome({ unmatched: 20, ineligible: 5, dropped: 9 }))).toBe(false);
  });

  it("has no work for a missing outcome", () => {
    expect(layerHasWork(null)).toBe(false);
    expect(layerHasWork(undefined)).toBe(false);
  });
});

describe("layerMoveCount (what a layer actually writes)", () => {
  it("writes only the fresh rows with Keep", () => {
    expect(layerMoveCount(outcome({ carried: 10, kept: 4 }), false)).toBe(10);
  });

  // Arming Overwrite moves `kept` into `replaced` WITHOUT changing the walk's total.
  it("writes the fresh rows plus the displaced ones with Overwrite", () => {
    expect(layerMoveCount(outcome({ carried: 10, kept: 4 }), true)).toBe(14);
  });

  it("is 0 for a missing outcome, armed or not", () => {
    expect(layerMoveCount(null, true)).toBe(0);
    expect(layerMoveCount(undefined, false)).toBe(0);
  });

  it("ignores rows that could never land", () => {
    expect(layerMoveCount(outcome({ unmatched: 7, ineligible: 2, dropped: 1 }), true)).toBe(0);
  });
});

describe("layerCountsText / layerSkipNote (the per-row copy)", () => {
  it("reports both halves of the choice", () => {
    expect(layerCountsText(outcome({ carried: 12, kept: 3 }))).toBe("12 to copy · 3 already set");
  });

  it("omits a zero half rather than printing '0 already set'", () => {
    expect(layerCountsText(outcome({ carried: 12 }))).toBe("12 to copy");
    expect(layerCountsText(outcome({ kept: 3 }))).toBe("3 already set");
  });

  it("is empty when the layer has nothing to offer (the row renders disabled instead)", () => {
    expect(layerCountsText(outcome({ unmatched: 40 }))).toBe("");
    expect(layerCountsText(null)).toBe("");
  });

  it("warns that a colour cannot carry when its column did not survive", () => {
    expect(layerSkipNote("colors", outcome({ carried: 2, dropped: 9 })))
      .toBe("9 skipped — that column is not in the revision");
  });

  it("warns that a category cannot land on a non-eligible destination row", () => {
    expect(layerSkipNote("categories", outcome({ carried: 2, ineligible: 5 })))
      .toBe("5 skipped — those rows cannot hold a category");
  });

  // Each drop reason belongs to exactly one layer; the others report 0 by construction.
  it("says nothing for a layer with no structural drops", () => {
    expect(layerSkipNote("remarks", outcome({ carried: 5, unmatched: 3 }))).toBe("");
    expect(layerSkipNote("categories", outcome({ dropped: 9 }))).toBe("");
    expect(layerSkipNote("colors", outcome({ ineligible: 9 }))).toBe("");
    expect(layerSkipNote("remark_dismissals", null)).toBe("");
  });
});

describe("armedLayerReplacements (the destructive footer's layer half)", () => {
  const s = layered({
    categories: outcome({ carried: 10, kept: 6 }),
    remarks: outcome({ carried: 2, kept: 4 }),
  });

  it("counts nothing while every layer is on Keep", () => {
    expect(armedLayerReplacements(s, choices())).toBe(0);
  });

  it("counts the displaced records of an armed layer", () => {
    expect(
      armedLayerReplacements(s, choices({ categories: { carry: true, overwrite: true } })),
    ).toBe(6);
  });

  it("sums across several armed layers", () => {
    expect(
      armedLayerReplacements(
        s,
        choices({
          categories: { carry: true, overwrite: true },
          remarks: { carry: true, overwrite: true },
        }),
      ),
    ).toBe(10);
  });

  // The armed flag is meaningless on a layer that is not carrying -- it writes nothing at all.
  it("ignores an armed layer that is NOT ticked to carry", () => {
    expect(
      armedLayerReplacements(s, choices({ remarks: { carry: false, overwrite: true } })),
    ).toBe(0);
  });

  it("counts nothing when the server sent no layer counts", () => {
    expect(
      armedLayerReplacements(sheet(), choices({ categories: { carry: true, overwrite: true } })),
    ).toBe(0);
  });
});

describe("buildLayersPayload (the wire)", () => {
  it("sends only the ticked layers -- an untouched layer is omitted, not carry:false", () => {
    expect(buildLayersPayload(initialLayerChoices())).toEqual({
      categories: { carry: true, overwrite: false },
    });
  });

  it("carries the overwrite flag of a ticked layer", () => {
    expect(
      buildLayersPayload(choices({ remarks: { carry: true, overwrite: true } })),
    ).toEqual({
      categories: { carry: true, overwrite: false },
      remarks: { carry: true, overwrite: true },
    });
  });

  // Rates-only is a legitimate ask, and is exactly the Amendment D behaviour.
  // WBC-S3a: toSTRICTEqual, not toEqual -- `toEqual({})` also passes for `{categories: undefined}`,
  // so it could not tell "the key was omitted" from "the key was written as undefined". The wire
  // cares (`JSON.stringify` drops both, but a spread into another payload would not).
  it("is EMPTY when every layer is unticked", () => {
    const none = Object.fromEntries(
      CARRY_LAYER_KEYS.map((k) => [k, { carry: false, overwrite: false }]),
    ) as LayerChoices;
    expect(buildLayersPayload(none)).toStrictEqual({});
    expect(Object.keys(buildLayersPayload(none))).toEqual([]);
  });

  it("never leaks an overwrite flag from an unticked layer", () => {
    const payload = buildLayersPayload(choices({ colors: { carry: false, overwrite: true } }));
    expect(payload.colors).toBeUndefined();
  });
});

describe("nothingToCarry (the apply gate, both axes)", () => {
  const s = layered({ categories: outcome({ carried: 140 }) });

  it("is false while any rate cell is selected", () => {
    const none = Object.fromEntries(
      CARRY_LAYER_KEYS.map((k) => [k, { carry: false, overwrite: false }]),
    ) as LayerChoices;
    expect(nothingToCarry(3, s, none)).toBe(false);
  });

  // THE regression this helper exists for: the pre-E gate was `selectedCount === 0`, which
  // refused a category-only carry -- real work, on the axis the amendment is about.
  it("is FALSE with zero rates but a carrying layer that would write", () => {
    expect(nothingToCarry(0, s, initialLayerChoices())).toBe(false);
  });

  it("is true with zero rates and every layer unticked", () => {
    const none = Object.fromEntries(
      CARRY_LAYER_KEYS.map((k) => [k, { carry: false, overwrite: false }]),
    ) as LayerChoices;
    expect(nothingToCarry(0, s, none)).toBe(true);
  });

  // Ticking a layer that cannot move anything is not work, and must not enable a no-op apply.
  it("is TRUE when the only ticked layer would write nothing", () => {
    const empty = layered({ categories: outcome({ unmatched: 50 }) });
    expect(nothingToCarry(0, empty, initialLayerChoices())).toBe(true);
  });

  it("is false when a ticked layer writes only because Overwrite is armed", () => {
    const keptOnly = layered({ categories: outcome({ kept: 6 }) });
    expect(nothingToCarry(0, keptOnly, initialLayerChoices())).toBe(true);
    expect(
      nothingToCarry(0, keptOnly, choices({ categories: { carry: true, overwrite: true } })),
    ).toBe(false);
  });

  it("is true when the server sent no layer counts and no rate is selected", () => {
    expect(nothingToCarry(0, sheet(), initialLayerChoices())).toBe(true);
  });
});

describe("carrySelectionSummary (the 'Will carry ...' line)", () => {
  const s = layered({
    categories: outcome({ carried: 140, kept: 3 }),
    remarks: outcome({ carried: 4 }),
  });

  it("names rates alone when no layer is ticked", () => {
    const none = Object.fromEntries(
      CARRY_LAYER_KEYS.map((k) => [k, { carry: false, overwrite: false }]),
    ) as LayerChoices;
    expect(carrySelectionSummary(12, s, none)).toBe("12 rates");
  });

  it("joins rates and one layer with 'and'", () => {
    expect(carrySelectionSummary(12, s, initialLayerChoices())).toBe("12 rates and 140 categories");
  });

  it("uses commas then a final 'and' for three parts", () => {
    expect(
      carrySelectionSummary(12, s, choices({ remarks: { carry: true, overwrite: false } })),
    ).toBe("12 rates, 140 categories and 4 remarks");
  });

  it("adds the displaced rows to a layer's figure once Overwrite is armed", () => {
    expect(
      carrySelectionSummary(0, s, choices({ categories: { carry: true, overwrite: true } })),
    ).toBe("143 categories");
  });

  it("uses the singular for exactly one rate", () => {
    expect(carrySelectionSummary(1, sheet(), initialLayerChoices())).toBe("1 rate");
  });

  it("omits a ticked layer that would move nothing -- never promise an empty layer", () => {
    const empty = layered({ categories: outcome({ unmatched: 9 }) });
    expect(carrySelectionSummary(2, empty, initialLayerChoices())).toBe("2 rates");
  });

  it("is empty when nothing at all is selected (the caller hides the line)", () => {
    const none = Object.fromEntries(
      CARRY_LAYER_KEYS.map((k) => [k, { carry: false, overwrite: false }]),
    ) as LayerChoices;
    expect(carrySelectionSummary(0, s, none)).toBe("");
  });

  it("labels every layer from the shared LAYER_LABEL map, lowercased", () => {
    const all = layered(
      Object.fromEntries(CARRY_LAYER_KEYS.map((k) => [k, outcome({ carried: 1 })])),
    );
    const every = Object.fromEntries(
      CARRY_LAYER_KEYS.map((k) => [k, { carry: true, overwrite: false }]),
    ) as LayerChoices;
    const line = carrySelectionSummary(0, all, every);
    for (const key of CARRY_LAYER_KEYS) {
      expect(line).toContain(LAYER_LABEL[key].toLowerCase());
    }
  });
});

// ── WBC-S3a / R11: the apply BUTTON's count ────────────────────────────────────────
// The button used to name `selectedCount` rates while the line above it named the WRITES, so the
// two could disagree by the number of un-armed conflicts -- reachable today as "Copy 12 rates
// forward" sitting above "Will copy 30 categories". `carryWriteCount` is the ONE number both carry
// surfaces' buttons read, and it is computed from the SAME walk that builds the line's phrases.
describe("carryWriteCount (what the apply button reports)", () => {
  const s = layered({
    categories: outcome({ carried: 140, kept: 3 }),
    remarks: outcome({ carried: 4 }),
  });

  it("sums the rate writes and every CARRYING layer's writes", () => {
    expect(carryWriteCount(12, s, initialLayerChoices())).toBe(152); // 12 rates + 140 categories
  });

  it("ignores a layer that is not ticked", () => {
    const none = Object.fromEntries(
      CARRY_LAYER_KEYS.map((k) => [k, { carry: false, overwrite: false }]),
    ) as LayerChoices;
    expect(carryWriteCount(12, s, none)).toBe(12);
  });

  it("adds the displaced records once Overwrite is armed", () => {
    expect(
      carryWriteCount(0, s, choices({ categories: { carry: true, overwrite: true } })),
    ).toBe(143); // 140 fresh + 3 displaced
  });

  it("omits a ticked layer that would move nothing", () => {
    const empty = layered({ categories: outcome({ unmatched: 9 }) });
    expect(carryWriteCount(2, empty, initialLayerChoices())).toBe(2);
  });

  it("is 0 when neither axis would write -- the all-Keep re-run", () => {
    const none = Object.fromEntries(
      CARRY_LAYER_KEYS.map((k) => [k, { carry: false, overwrite: false }]),
    ) as LayerChoices;
    expect(carryWriteCount(0, s, none)).toBe(0);
  });

  it("degrades to the rate count when the server sent no layer preview", () => {
    expect(carryWriteCount(7, sheet(), initialLayerChoices())).toBe(7);
    expect(carryWriteCount(7, null, initialLayerChoices())).toBe(7);
  });

  // THE guarantee R11 is about: the button sits directly above the "Will carry ..." line, so its
  // number must be the sum of the numbers that line names -- not a second, independently derived
  // count that can drift away from it. Read back out of the rendered line, not recomputed.
  it("is exactly the sum of the figures the 'Will carry ...' line names", () => {
    const c = choices({ remarks: { carry: true, overwrite: false } });
    const line = carrySelectionSummary(12, s, c);
    expect(line).toBe("12 rates, 140 categories and 4 remarks");
    const namedTotal = [...line.matchAll(/\d+/g)].reduce((sum, m) => sum + Number(m[0]), 0);
    expect(carryWriteCount(12, s, c)).toBe(namedTotal);
  });

  it("stays in step with the line when the line is empty", () => {
    const none = Object.fromEntries(
      CARRY_LAYER_KEYS.map((k) => [k, { carry: false, overwrite: false }]),
    ) as LayerChoices;
    expect(carrySelectionSummary(0, s, none)).toBe("");
    expect(carryWriteCount(0, s, none)).toBe(0);
  });
});

// ── WBC-S3a / R9: the per-surface destination noun ─────────────────────────────────
// Two strings in the shared block describe the destination as "the revision", which is false on the
// within-BoQ surface (there is no revision inside one BoQ). The noun is now a parameter with the
// CROSS-BoQ wording as its default, so this dialog is untouched -- the same shape S5 used for the
// block's subtext.
describe("the destination noun on the CROSS-BoQ surface (R9)", () => {
  it("defaults to 'the revision', verbatim", () => {
    expect(CARRY_DESTINATION_CROSS_BOQ).toBe("the revision");
  });

  it("keeps the colour hint byte-identical when no destination is named", () => {
    expect(layerHint("colors")).toBe(
      "Colour marks. Only columns that still exist in the revision can carry.",
    );
    expect(layerHint("colors", CARRY_DESTINATION_CROSS_BOQ)).toBe(layerHint("colors"));
  });

  it("keeps the colour skip note byte-identical when no destination is named", () => {
    expect(layerSkipNote("colors", outcome({ carried: 2, dropped: 9 }))).toBe(
      "9 skipped — that column is not in the revision",
    );
  });

  it("leaves the three other hints free of any destination noun at all", () => {
    expect(layerHint("categories")).toBe("The classification verdict on each row.");
    expect(layerHint("remarks")).toBe("Notes written against a cell.");
    expect(layerHint("remark_dismissals")).toBe("Review flags someone has already dismissed.");
  });
});

// ── WBC-S3a / R11: the whole-BoQ button's count ────────────────────────────────────
// The hub path offers no layer choice, so its button's number is purely rates -- but it must still
// be WRITES rather than the raw selection, for exactly the reason the single-sheet line was fixed.
describe("rateWriteCountAll (the whole-BoQ write count)", () => {
  const k = (s: string, r: number) =>
    cellKey(s, { dest_excel_row: r, area: null, rate_kind: "combined_rate" });

  it("sums each sheet's writes", () => {
    const { selected, overwrite } = initialSelection(SHEETS);
    // Electrical pre-ticks 3 clean + 1 conflict-on-Keep; Plumbing is blocked, so nothing at all.
    expect(rateWriteCountAll(SHEETS, selected, overwrite)).toBe(3);
  });

  it("counts a conflict on a second sheet once it is selected and armed", () => {
    const selected = new Set([k("Electrical", 10), k("Plumbing", 120), k("Plumbing", 121)]);
    expect(rateWriteCountAll(SHEETS, selected, { [k("Plumbing", 121)]: true })).toBe(3);
  });

  it("is 0 for an empty sheet list and for an empty selection", () => {
    expect(rateWriteCountAll([], new Set(), {})).toBe(0);
    expect(rateWriteCountAll(SHEETS, new Set(), {})).toBe(0);
  });

  it("agrees with the per-sheet count summed by hand", () => {
    const { selected, overwrite } = initialSelection(SHEETS);
    const byHand = SHEETS.reduce((n, s) => n + rateWriteCount(s, selected, overwrite), 0);
    expect(rateWriteCountAll(SHEETS, selected, overwrite)).toBe(byHand);
  });
});

// ── AMENDMENT E follow-up: the "Will carry ..." line must count WRITES, not selection ──────
// Found by the live E2E: on a re-run every conflict is pre-selected with Keep, so the dialog
// promised "Will carry 12 rates" and the apply answered "Nothing was carried. 12 existing rates
// left as they were." The layer half already respected the choice, so one sentence disagreed
// with itself.
describe("rateWriteCount (what the apply will actually write)", () => {
  const k = (r: number) => cellKey("Electrical", { dest_excel_row: r, area: null, rate_kind: "combined_rate" });
  const mixed = sheet({
    plan: [
      row({ dest_excel_row: 10, outcome: 2 }),                      // clean
      row({ dest_excel_row: 11, outcome: 2 }),                      // clean
      row({ dest_excel_row: 12, outcome: 3, current_rate: 999 }),   // conflict
      row({ dest_excel_row: 13, outcome: 3, current_rate: 888 }),   // conflict
      row({ dest_excel_row: 14, outcome: 1, skip_reason: "removed" }), // hard skip
    ],
  });
  const all = new Set([k(10), k(11), k(12), k(13), k(14)]);

  it("counts a selected clean copy", () => {
    expect(rateWriteCount(mixed, new Set([k(10), k(11)]), {})).toBe(2);
  });

  it("does NOT count a selected conflict left on Keep -- it writes nothing", () => {
    expect(rateWriteCount(mixed, new Set([k(12), k(13)]), {})).toBe(0);
  });

  it("counts a selected conflict once Overwrite is armed", () => {
    expect(rateWriteCount(mixed, new Set([k(12), k(13)]), { [k(12)]: true })).toBe(1);
  });

  // THE regression: everything selected, every conflict on Keep -> only the clean rows write.
  it("counts only the clean rows when all are selected and no conflict is armed", () => {
    expect(rateWriteCount(mixed, all, {})).toBe(2);
  });

  it("never counts a hard skip, selected or not", () => {
    expect(rateWriteCount(mixed, new Set([k(14)]), { [k(14)]: true })).toBe(0);
  });

  it("is 0 for an unselected plan and for a missing sheet", () => {
    expect(rateWriteCount(mixed, new Set(), {})).toBe(0);
    expect(rateWriteCount(null, all, {})).toBe(0);
    expect(rateWriteCount(undefined, all, {})).toBe(0);
  });

  it("the all-Keep re-run case reports NOTHING rather than the selection size", () => {
    const carried = sheet({
      plan: [10, 11, 12].map((r) => row({ dest_excel_row: r, outcome: 3, current_rate: 5 })),
    });
    const sel = new Set([10, 11, 12].map(k));
    expect(sel.size).toBe(3);                          // all selected ...
    expect(rateWriteCount(carried, sel, {})).toBe(0);  // ... and none of them write
    // and so the sentence promises nothing, matching the apply's own answer
    const none = Object.fromEntries(
      CARRY_LAYER_KEYS.map((key) => [key, { carry: false, overwrite: false }]),
    ) as LayerChoices;
    expect(carrySelectionSummary(rateWriteCount(carried, sel, {}), carried, none)).toBe("");
  });
});
