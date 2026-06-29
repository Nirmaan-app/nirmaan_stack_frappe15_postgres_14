// Unit tests for the copy-forward dialog's PURE helpers (BoQ Phase 5 version-view slice 2):
// the per-cell key, the writable predicate, the default selection (clean + conflicts pre-ticked,
// conflicts default KEEP), bulk overwrite/keep, and the decision-payload builder. No DOM.
import { describe, it, expect } from "vitest";
import {
  cellKey,
  isWritable,
  initialSelection,
  applyBulkOverwrite,
  buildDecisions,
  outcomeMetaKey,
} from "./CopyForwardDialog";
import type { CopyForwardPlanRow } from "./boqTypes";

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
