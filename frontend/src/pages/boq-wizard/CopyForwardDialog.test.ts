// Unit tests for the copy-forward dialog's PURE helpers (BoQ Phase 5 version-view slice 2):
// the per-cell key, the writable predicate, the default selection (clean + conflicts pre-ticked,
// conflicts default KEEP), bulk overwrite/keep, and the decision-payload builder. No DOM.
//
// WBC-W3-S5 (ADR-0014 Amendment F R1) adds the opt-in non-rate LAYERS to this seam: the shared
// CarryLayers block, its wire payload, and the write-not-selection count the summary line reports.
import { describe, it, expect } from "vitest";
import {
  cellKey,
  isWritable,
  initialSelection,
  applyBulkOverwrite,
  buildDecisions,
  outcomeMetaKey,
  rateWriteCount,
  type CopyForwardPlanMessage,
} from "./CopyForwardDialog";
import {
  LAYER_BLOCK_SUBTEXT_CROSS_BOQ,
  LAYER_BLOCK_SUBTEXT_WITHIN_BOQ,
  buildLayersPayload,
  carrySelectionSummary,
  initialLayerChoices,
  layerOutcomeFor,
  nothingToCarry,
  type CarryLayerSource,
  type LayerChoices,
} from "./CarryLayers";
import { CARRY_LAYER_KEYS } from "./boqTypes";
import type {
  CarryLayerOutcome,
  CopyForwardPlanRow,
  CrossBoqCarrySheet,
} from "./boqTypes";

function row(over: Partial<CopyForwardPlanRow> = {}): CopyForwardPlanRow {
  return {
    excel_row: 10,
    description: "Item",
    source_rate: 100,
    area: null,
    rate_kind: "combined_rate",
    outcome: 2,
    skip_reason: null,
    target_col_letter: "D",
    current_rate: null,
    reason: null,
    ...over,
  };
}

const PLAN: CopyForwardPlanRow[] = [
  row({ excel_row: 10, outcome: 2 }), // clean
  row({ excel_row: 11, outcome: 3, current_rate: 999 }), // conflict
  row({ excel_row: 12, outcome: 1, skip_reason: "non_match", target_col_letter: null, reason: "moved" }), // skip
  // a per-area row carrying TWO rate cells -> distinct cell keys on the same excel_row
  row({ excel_row: 13, outcome: 2, area: "Phase 1", rate_kind: "combined_rate" }),
  row({ excel_row: 13, outcome: 2, area: "Phase 2", rate_kind: "combined_rate" }),
];

/** A planned layer outcome. Every field defaults to 0 so a test names only what it is about. */
function outcome(over: Partial<CarryLayerOutcome> = {}): CarryLayerOutcome {
  return { carried: 0, replaced: 0, kept: 0, unmatched: 0, ineligible: 0, dropped: 0, ...over };
}

/** A `get_copy_forward_plan` response as the dialog reads it. `layers` absent by default -- that is
 *  the pre-Amendment-F server, and the degradation path has to keep working. */
function planMessage(over: Partial<CopyForwardPlanMessage> = {}): CopyForwardPlanMessage {
  return {
    plan: PLAN,
    from_version: 1,
    current_version: 2,
    current_formulas_complete: true,
    counts: { clean: 3, conflict: 1, non_match: 1, no_rate_column: 0, non_priceable: 0 },
    ...over,
  };
}

/** The CROSS-BoQ caller's concrete shape -- the other side of the structural-type proof below. */
function crossBoqSheet(over: Partial<CrossBoqCarrySheet> = {}): CrossBoqCarrySheet {
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

describe("cellKey", () => {
  it("distinguishes two rate cells on the same excel_row by area", () => {
    expect(cellKey(PLAN[3])).not.toBe(cellKey(PLAN[4]));
    expect(cellKey(PLAN[3])).toBe("13|Phase 1|combined_rate");
  });
});

describe("isWritable / outcomeMetaKey", () => {
  it("writable for clean (2) and conflict (3), not for skip (1)", () => {
    expect(isWritable(row({ outcome: 2 }))).toBe(true);
    expect(isWritable(row({ outcome: 3 }))).toBe(true);
    expect(isWritable(row({ outcome: 1 }))).toBe(false);
  });
  it("maps outcomes to presentation keys", () => {
    expect(outcomeMetaKey(row({ outcome: 2 }))).toBe("clean");
    expect(outcomeMetaKey(row({ outcome: 3 }))).toBe("conflict");
    expect(outcomeMetaKey(row({ outcome: 1 }))).toBe("skip");
  });
});

describe("initialSelection", () => {
  it("pre-ticks every writable cell and excludes hard skips", () => {
    const { selected } = initialSelection(PLAN);
    expect(selected.has(cellKey(PLAN[0]))).toBe(true); // clean
    expect(selected.has(cellKey(PLAN[1]))).toBe(true); // conflict
    expect(selected.has(cellKey(PLAN[2]))).toBe(false); // skip excluded
    expect(selected.size).toBe(4); // 2 clean + 1 conflict + 2 per-area clean... (10,11,13a,13b)
  });
  it("defaults conflicts to KEEP (overwrite false)", () => {
    const { overwrite } = initialSelection(PLAN);
    expect(overwrite[cellKey(PLAN[1])]).toBe(false);
    // no overwrite entry for clean rows
    expect(cellKey(PLAN[0]) in overwrite).toBe(false);
  });
});

describe("applyBulkOverwrite", () => {
  it("sets every conflict to overwrite=true on 'overwrite all'", () => {
    const ow = applyBulkOverwrite(PLAN, true);
    expect(ow[cellKey(PLAN[1])]).toBe(true);
    // clean rows are not conflicts -> not present
    expect(cellKey(PLAN[0]) in ow).toBe(false);
  });
  it("sets every conflict to keep on 'keep all'", () => {
    expect(applyBulkOverwrite(PLAN, false)[cellKey(PLAN[1])]).toBe(false);
  });
});

describe("buildDecisions", () => {
  it("emits only selected writable cells, with the conflict overwrite flag", () => {
    const { selected } = initialSelection(PLAN);
    const overwrite = applyBulkOverwrite(PLAN, true);
    const decisions = buildDecisions(PLAN, selected, overwrite);
    // 4 writable cells selected; the skip is never emitted
    expect(decisions).toHaveLength(4);
    const conflict = decisions.find((d) => d.excel_row === 11);
    expect(conflict?.overwrite).toBe(true);
    const clean = decisions.find((d) => d.excel_row === 10);
    expect(clean?.overwrite).toBe(false); // clean rows always carry overwrite=false
  });
  it("drops a cell the user un-ticked", () => {
    const { selected, overwrite } = initialSelection(PLAN);
    selected.delete(cellKey(PLAN[0]));
    const decisions = buildDecisions(PLAN, selected, overwrite);
    expect(decisions.some((d) => d.excel_row === 10 && d.area === null)).toBe(false);
  });
});

// ── WBC-W3-S5: the opt-in non-rate layers on this seam (ADR-0014 Amendment F R1) ────

describe("the layer defaults on the copy-forward dialog", () => {
  it("ticks categories and leaves the three annotation layers off", () => {
    const choices = initialLayerChoices();
    expect(choices.categories.carry).toBe(true);
    expect(choices.remarks.carry).toBe(false);
    expect(choices.colors.carry).toBe(false);
    expect(choices.remark_dismissals.carry).toBe(false);
  });
  it("arms no overwrite anywhere -- Keep is the default on every layer", () => {
    const choices = initialLayerChoices();
    for (const key of CARRY_LAYER_KEYS) expect(choices[key].overwrite).toBe(false);
  });
});

describe("buildLayersPayload -- the `layers` field of the apply_copy_forward POST", () => {
  it("posts categories alone under the defaults", () => {
    expect(buildLayersPayload(initialLayerChoices())).toEqual({
      categories: { carry: true, overwrite: false },
    });
  });
  it("OMITS an unticked layer, so an all-off choice posts {} -- rates only", () => {
    const allOff: LayerChoices = {
      ...initialLayerChoices(),
      categories: { carry: false, overwrite: false },
    };
    expect(buildLayersPayload(allOff)).toEqual({});
    // The omitted-layer case ON THE WIRE: the server reads {} as "carry nothing but the rates",
    // which is exactly what a client that never learned about layers keeps getting.
    expect(JSON.stringify(buildLayersPayload(allOff))).toBe("{}");
  });
  it("carries an armed overwrite through, per layer", () => {
    const choices: LayerChoices = {
      ...initialLayerChoices(),
      remarks: { carry: true, overwrite: true },
    };
    expect(buildLayersPayload(choices)).toEqual({
      categories: { carry: true, overwrite: false },
      remarks: { carry: true, overwrite: true },
    });
  });
});

describe("rateWriteCount -- WRITES, not the selection size", () => {
  it("excludes a selected conflict left on Keep (the 313697e7 defect on this seam)", () => {
    const { selected, overwrite } = initialSelection(PLAN);
    expect(selected.size).toBe(4); // 3 clean + 1 conflict, all pre-ticked
    expect(rateWriteCount(PLAN, selected, overwrite)).toBe(3); // the Keep conflict writes nothing
  });
  it("includes the conflict once Overwrite is armed", () => {
    const { selected } = initialSelection(PLAN);
    expect(rateWriteCount(PLAN, selected, applyBulkOverwrite(PLAN, true))).toBe(4);
  });
  it("never counts a hard skip, even if its key somehow reaches the selection", () => {
    const { selected, overwrite } = initialSelection(PLAN);
    selected.add(cellKey(PLAN[2])); // the non_match skip
    expect(rateWriteCount(PLAN, selected, overwrite)).toBe(3);
  });
  it("drops an un-ticked clean cell", () => {
    const { selected, overwrite } = initialSelection(PLAN);
    selected.delete(cellKey(PLAN[0]));
    expect(rateWriteCount(PLAN, selected, overwrite)).toBe(2);
  });
  it("is 0 on an all-Keep re-run -- the shape that made the old count lie", () => {
    const conflictsOnly = [row({ excel_row: 20, outcome: 3, current_rate: 500 })];
    const { selected, overwrite } = initialSelection(conflictsOnly);
    expect(selected.size).toBe(1);
    expect(rateWriteCount(conflictsOnly, selected, overwrite)).toBe(0);
  });
});

describe("carrySelectionSummary over the copy-forward plan", () => {
  it("reports the write count beside the layer counts, never the selection size", () => {
    const { selected, overwrite } = initialSelection(PLAN);
    const message = planMessage({ layers: { categories: outcome({ carried: 5 }) } });
    expect(
      carrySelectionSummary(
        rateWriteCount(PLAN, selected, overwrite),
        message,
        initialLayerChoices(),
      ),
    ).toBe("3 rates and 5 categories");
  });
  it("drops the rate clause when every conflict is on Keep, and still names the layer", () => {
    const conflictsOnly = [row({ excel_row: 20, outcome: 3, current_rate: 500 })];
    const { selected, overwrite } = initialSelection(conflictsOnly);
    const message = planMessage({
      plan: conflictsOnly,
      layers: { categories: outcome({ carried: 5 }) },
    });
    expect(
      carrySelectionSummary(
        rateWriteCount(conflictsOnly, selected, overwrite),
        message,
        initialLayerChoices(),
      ),
    ).toBe("5 categories");
  });
});

describe("nothingToCarry -- the apply gate spans BOTH axes on this seam too", () => {
  it("allows a layers-only apply: every rate un-ticked, but categories would still move", () => {
    const message = planMessage({ layers: { categories: outcome({ carried: 3 }) } });
    expect(nothingToCarry(0, message, initialLayerChoices())).toBe(false);
  });
  it("refuses when neither axis would write anything", () => {
    const message = planMessage({ layers: { categories: outcome() } });
    expect(nothingToCarry(0, message, initialLayerChoices())).toBe(true);
  });
  it("is never blocking while a rate would write", () => {
    expect(nothingToCarry(1, planMessage(), initialLayerChoices())).toBe(false);
  });
});

describe("CarryLayerSource -- the shared block's structural parameter", () => {
  it("is satisfied by BOTH callers' concrete shapes, reading the same preview off each", () => {
    const layers = { categories: outcome({ carried: 4, kept: 2 }) };
    // The two callers pass structurally different objects; `layers` is the one fact either is read
    // for, which is why the shared module must not be typed to the cross-BoQ sheet.
    const crossBoq: CarryLayerSource = crossBoqSheet({ layers });
    const withinBoq: CarryLayerSource = planMessage({ layers });
    expect(layerOutcomeFor(crossBoq, "categories")).toEqual(
      layerOutcomeFor(withinBoq, "categories"),
    );
    expect(carrySelectionSummary(1, crossBoq, initialLayerChoices())).toBe(
      carrySelectionSummary(1, withinBoq, initialLayerChoices()),
    );
  });
  it("degrades to no counts when the server sends no preview at all", () => {
    expect(layerOutcomeFor(planMessage(), "categories")).toBeNull();
    expect(nothingToCarry(0, planMessage(), initialLayerChoices())).toBe(true);
  });
});

describe("the layer block's subtext", () => {
  it("names the VERSION within one BoQ -- both versions ARE the same BoQ (R3)", () => {
    expect(LAYER_BLOCK_SUBTEXT_WITHIN_BOQ).toContain("the version it came from");
    expect(LAYER_BLOCK_SUBTEXT_WITHIN_BOQ).not.toContain("BoQ");
    expect(LAYER_BLOCK_SUBTEXT_WITHIN_BOQ).not.toContain("revision");
  });
  it("leaves the cross-BoQ subtext verbatim", () => {
    expect(LAYER_BLOCK_SUBTEXT_CROSS_BOQ).toBe(
      "Optional. Anything copied is marked with the BoQ it came from, so it stays tellable apart " +
        "from work done on this revision.",
    );
  });
});
