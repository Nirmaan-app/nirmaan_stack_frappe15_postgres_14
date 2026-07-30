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
  summarizeCopyForward,
} from "./CopyForwardDialog";
import {
  CARRY_DESTINATION_WITHIN_BOQ,
  LAYER_BLOCK_SUBTEXT_CROSS_BOQ,
  LAYER_BLOCK_SUBTEXT_WITHIN_BOQ,
  buildLayersPayload,
  carrySelectionSummary,
  carryWriteCount,
  initialLayerChoices,
  layerHint,
  layerOutcomeFor,
  layerSkipNote,
  nothingToCarry,
  type CarryLayerSource,
  type LayerChoices,
} from "./CarryLayers";
import { CARRY_LAYER_KEYS } from "./boqTypes";
import type {
  ApplyCopyForwardResponse,
  CarryLayerOutcome,
  CopyForwardPlanRow,
  CrossBoqCarrySheet,
  GetCopyForwardPlanResponse,
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
 *  the pre-Amendment-F server, and the degradation path has to keep working.
 *
 *  WBC-S3a: typed as the DECLARED response now that `layers?` lives on `GetCopyForwardPlanResponse`
 *  itself. S5 had to compose a local `CopyForwardPlanMessage` because `boqTypes.ts` was out of its
 *  scope; that workaround is gone. */
function planMessage(
  over: Partial<GetCopyForwardPlanResponse> = {},
): GetCopyForwardPlanResponse {
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
    // WBC-S3a: toSTRICTEqual. Both of the original assertions shared one blind spot -- `toEqual({})`
    // AND `JSON.stringify(...) === "{}"` are BOTH satisfied by `{categories: undefined}`, so neither
    // could tell an omitted key from a key written as undefined.
    expect(buildLayersPayload(allOff)).toStrictEqual({});
    expect(Object.keys(buildLayersPayload(allOff))).toEqual([]);
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

// ── WBC-S3a / R9: the destination noun inside the SHARED block's copy ──────────────
// The colour hint and the colour skip note both said "the revision", which is a cross-BoQ fact:
// within one BoQ there IS no revision, only an older and a current VERSION of the same sheet. The
// noun is a parameter with the cross-BoQ wording as its default (the S5 subtext pattern), so this
// surface passes its own and the other one is untouched.
describe("the destination noun on the WITHIN-BoQ surface (R9)", () => {
  it("names the current version, not a revision", () => {
    expect(CARRY_DESTINATION_WITHIN_BOQ).toBe("the current version");
    expect(CARRY_DESTINATION_WITHIN_BOQ).not.toContain("revision");
  });

  it("rewords the colour hint", () => {
    expect(layerHint("colors", CARRY_DESTINATION_WITHIN_BOQ)).toBe(
      "Colour marks. Only columns that still exist in the current version can carry.",
    );
  });

  it("rewords the colour skip note", () => {
    expect(layerSkipNote("colors", outcome({ dropped: 9 }), CARRY_DESTINATION_WITHIN_BOQ)).toBe(
      "9 skipped — that column is not in the current version",
    );
  });

  // Only the two strings that NAME the destination may differ between the surfaces; every other
  // string in the block is one shared sentence and must stay literally identical.
  it("changes nothing else -- every other hint is identical across the two surfaces", () => {
    for (const key of CARRY_LAYER_KEYS) {
      if (key === "colors") continue;
      expect(layerHint(key, CARRY_DESTINATION_WITHIN_BOQ)).toBe(layerHint(key));
    }
  });

  it("leaves the categories skip note identical across the two surfaces", () => {
    const o = outcome({ ineligible: 5 });
    expect(layerSkipNote("categories", o, CARRY_DESTINATION_WITHIN_BOQ)).toBe(
      layerSkipNote("categories", o),
    );
  });
});

// ── WBC-S3a / R11: the apply button's count on THIS seam ───────────────────────────
// The live defect: `initialSelection` pre-selects conflicts with overwrite=false, so the button
// ("Copy 12 rates forward", from selected.size) could sit directly above a line reading "Will copy
// 30 categories" -- and pressing it wrote zero rates. Both figures now come from one walk.
describe("carryWriteCount over the copy-forward plan", () => {
  it("counts writes across BOTH axes, never the selection size", () => {
    const { selected, overwrite } = initialSelection(PLAN);
    const message = planMessage({ layers: { categories: outcome({ carried: 30 }) } });
    expect(selected.size).toBe(4); // what the OLD button reported
    expect(carryWriteCount(rateWriteCount(PLAN, selected, overwrite), message, initialLayerChoices()))
      .toBe(33); // 3 rate writes (the Keep conflict writes nothing) + 30 categories
  });

  // The exact contradiction R11 names: every rate is a conflict on Keep, so the rate axis is silent
  // and only the layer moves. The button must not claim the rates.
  it("reports the layer alone when every selected rate is a conflict on Keep", () => {
    const conflictsOnly = [row({ excel_row: 20, outcome: 3, current_rate: 500 })];
    const { selected, overwrite } = initialSelection(conflictsOnly);
    const message = planMessage({
      plan: conflictsOnly,
      layers: { categories: outcome({ carried: 30 }) },
    });
    const rates = rateWriteCount(conflictsOnly, selected, overwrite);
    expect(selected.size).toBe(1);
    expect(rates).toBe(0);
    expect(carryWriteCount(rates, message, initialLayerChoices())).toBe(30);
    expect(carrySelectionSummary(rates, message, initialLayerChoices())).toBe("30 categories");
  });

  it("agrees with the 'Will copy ...' line it sits under, figure for figure", () => {
    const { selected, overwrite } = initialSelection(PLAN);
    const message = planMessage({ layers: { categories: outcome({ carried: 5 }) } });
    const rates = rateWriteCount(PLAN, selected, overwrite);
    const line = carrySelectionSummary(rates, message, initialLayerChoices());
    expect(line).toBe("3 rates and 5 categories");
    const namedTotal = [...line.matchAll(/\d+/g)].reduce((sum, m) => sum + Number(m[0]), 0);
    expect(carryWriteCount(rates, message, initialLayerChoices())).toBe(namedTotal);
  });

  it("is 0 when the button is disabled anyway -- no rate, no layer", () => {
    expect(carryWriteCount(0, planMessage(), initialLayerChoices())).toBe(0);
  });
});

// ── WBC-S3a: the post-apply line ───────────────────────────────────────────────────
// It reported rates only, so a categories-only copy -- the SAME likeliest shape the cross-BoQ seam
// already answers -- read "Copied 0 rates into the current version." True, and useless. This mirrors
// summarizeSheetCarry's multi-axis branch, in this surface's own voice.
describe("summarizeCopyForward (the post-apply line)", () => {
  const res = (over: Partial<ApplyCopyForwardResponse> = {}): ApplyCopyForwardResponse => ({
    ok: true,
    copied: 0,
    conflicts_overwritten: 0,
    conflicts_kept: 0,
    skipped: { non_match: 0, no_rate_column: 0, non_priceable: 0, invalid: 0 },
    ...over,
  });

  it("counts a clean copy and an overwrite as both landed", () => {
    expect(summarizeCopyForward(res({ copied: 10, conflicts_overwritten: 2 }))).toBe(
      "Copied 12 rates into the current version.",
    );
  });

  it("uses the singular for exactly one rate", () => {
    expect(summarizeCopyForward(res({ copied: 1 }))).toBe(
      "Copied 1 rate into the current version.",
    );
  });

  it("names each layer that landed, beside the rates", () => {
    expect(
      summarizeCopyForward(
        res({ copied: 5, layers: { categories: outcome({ carried: 140, replaced: 3 }) } }),
      ),
    ).toBe("Copied 5 rates and 143 categories into the current version.");
  });

  // THE under-report this exists for.
  it("does NOT say '0 rates' when only a layer landed", () => {
    expect(summarizeCopyForward(res({ layers: { categories: outcome({ carried: 30 }) } }))).toBe(
      "Copied 30 categories into the current version.",
    );
  });

  it("ignores a layer that ran but moved nothing", () => {
    expect(summarizeCopyForward(res({ copied: 5, layers: { colors: outcome({ dropped: 9 }) } })))
      .toBe("Copied 5 rates into the current version.");
  });

  it("says so plainly when nothing landed at all", () => {
    expect(summarizeCopyForward(res())).toBe("Nothing was copied into the current version.");
  });

  it("reports what was deliberately left alone", () => {
    expect(summarizeCopyForward(res({ copied: 1, conflicts_kept: 3 }))).toBe(
      "Copied 1 rate into the current version. 3 existing rates left as they were.",
    );
  });

  it("rolls the four skip reasons into one figure", () => {
    expect(
      summarizeCopyForward(
        res({ copied: 1, skipped: { non_match: 2, no_rate_column: 1, non_priceable: 0, invalid: 1 } }),
      ),
    ).toBe("Copied 1 rate into the current version. 4 rows skipped.");
  });

  it("survives a missing payload", () => {
    expect(summarizeCopyForward(undefined)).toBe("Nothing was copied into the current version.");
    expect(summarizeCopyForward(null)).toBe("Nothing was copied into the current version.");
  });
});
