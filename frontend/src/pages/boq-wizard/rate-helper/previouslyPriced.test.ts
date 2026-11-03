// DEV2-B5 S4 (owner R-H2AI; COLOURS 16:13; DISPLAY ORDER 11:06; G4 (a) / G13 / G14 (a)). The PURE rules of the
// "Previously priced" card (rateHelperRegistry.ts) and its link / pop-up helpers (PreviouslyPricedMatches.tsx).
//
//   range        min - max of the shown matches' TOTAL; not-a-match and other-unit left out; one figure for one;
//                "–" for none                                      / a flagged or other-unit match never moves it
//   total        supply + install where split, else the combined rate
//   unit         spellings folded ("Nos." = "Each"); unknown on either side is never "other unit"
//   order        the stored display order is kept; at most 5 shown
//   dots' text   the words per colour (tooltip and screen reader)
//   greyed       not run / running / no earlier match / failed: reason  / matches -> a decline CARRYING matches
//   no Use/badge the result is never a Suggestion, so suggestionCountsByKind never counts it
//   ?row=        the link names the pricing route and the row; prev / next wrap
import { describe, expect, it } from "vitest";

import {
  MATCH_DOT_TEXT,
  MATCH_STATE_TEXT,
  buildHelperList,
  isOtherUnit,
  makePreviouslyPricedHelper,
  matchRange,
  matchTotal,
  normUnit,
  previouslyPricedHelper,
  previouslyPricedResult,
  rangeText,
  RATE_HELPERS,
  shownMatches,
  suggestionCountsByKind,
  type MatchRunData,
  type PreviouslyPricedInput,
} from "./rateHelperRegistry";
import { matchRowHref, payloadLevels, stepIndex } from "./PreviouslyPricedMatches";
import type { PreviousMatch, RateHelperRowContext } from "./rateHelperTypes";

const M = (over: Partial<PreviousMatch>): PreviousMatch => ({
  key: "k", boq: "BOQ-1", sheet_name: "S", excel_row: 1, verdict: "SAME", colour: "green", unit: "Nos", ...over,
});

const ACTIONS = {
  canMark: true, canOpenBoqs: true,
  loadDetail: async () => ({ boq: "B", sheet_name: "S", excel_row: 1, can_open: true }),
  onMark: async () => {}, onUndo: async () => {},
};
const RUN: MatchRunData = {
  name: "BRMR-1", status: "complete", commit_version: 1,
  rows: [
    { excel_row: 5, status: "matched", matches: [M({ key: "a", supply_rate: 100, install_rate: 20 }), M({ key: "b", colour: "amber", total_rate: 150 })] },
    { excel_row: 6, status: "no match shown", matches: [] },
    { excel_row: 7, status: "no verdict", no_verdict: "the call failed: timeout", matches: [] },
  ],
};
const input = (over: Partial<PreviouslyPricedInput> = {}): PreviouslyPricedInput => ({
  run: RUN, running: false, failedReason: null, boq: "BOQ-T", sheetName: "Sheet", unitByExcelRow: new Map([[5, "No."]]),
  actions: ACTIONS, ...over,
});
const CTX = (excelRow: number): RateHelperRowContext => ({ excelRow, description: "d", nodeType: "Line Item", category: null, discipline: null, rateKinds: ["supply_rate"] });

describe("the total and the range (G13)", () => {
  it("total = supply + install where split, else the combined rate", () => {
    expect(matchTotal(M({ supply_rate: 100, install_rate: 20, total_rate: 999 }))).toBe(120);
    expect(matchTotal(M({ supply_rate: 100 }))).toBe(100);
    expect(matchTotal(M({ total_rate: 150 }))).toBe(150);
    expect(matchTotal(M({}))).toBeNull();
  });

  it("min - max over the shown matches; one figure for one; '–' for none", () => {
    const r = matchRange({ rowUnit: "Nos", matches: [M({ total_rate: 150 }), M({ total_rate: 90 }), M({ total_rate: 120 })] });
    expect(r).toEqual({ lo: 90, hi: 150, count: 3, left: 0 });
    expect(rangeText(r)).toBe("Rs 90 – Rs 150");
    expect(rangeText(matchRange({ rowUnit: "Nos", matches: [M({ total_rate: 1190 })] }))).toBe("Rs 1,190");
    expect(rangeText(null)).toBe("–");
  });

  it("a not-a-match one is LEFT OUT of the range", () => {
    const flagged = M({ total_rate: 5000, flag: { action: "not_a_match", reason: "Different item" } });
    const r = matchRange({ rowUnit: "Nos", matches: [M({ total_rate: 100 }), flagged] });
    expect(r).toEqual({ lo: 100, hi: 100, count: 1, left: 1 });
    expect(matchRange({ rowUnit: "Nos", matches: [flagged] })).toBeNull();
  });

  it("a match in ANOTHER unit is flagged and LEFT OUT of the range", () => {
    const other = M({ total_rate: 9, unit: "Rmt" });
    expect(isOtherUnit(other, "Nos")).toBe(true);
    expect(matchRange({ rowUnit: "Nos", matches: [M({ total_rate: 100 }), other] })).toEqual({ lo: 100, hi: 100, count: 1, left: 1 });
  });

  it("units fold their spellings; an unknown unit is never 'other'", () => {
    expect(normUnit("Nos.")).toBe(normUnit("each"));
    expect(normUnit("R.M.")).toBe(normUnit("Mtr"));
    expect(isOtherUnit(M({ unit: "No" }), "Nos.")).toBe(false);
    expect(isOtherUnit(M({ unit: null }), "Nos")).toBe(false);
    expect(isOtherUnit(M({ unit: "Rmt" }), "")).toBe(false);
  });
});

describe("order and the dots' words", () => {
  it("keeps the stored display order and shows at most 5", () => {
    const ms = ["g1", "g2", "a1", "r1", "r2", "r3"].map((k) => M({ key: k }));
    expect(shownMatches(ms).map((m) => m.key)).toEqual(["g1", "g2", "a1", "r1", "r2"]);
  });

  it("every colour has its words (colour is never the only signal)", () => {
    expect(MATCH_DOT_TEXT).toEqual({
      green: "Likely the same",
      amber: "Check - a spec is stated on one side only",
      red: "Close - a spec differs",
    });
  });
});

describe("the greyed states (D3) and the closure", () => {
  it("running / not run / failed / no earlier match", () => {
    expect(previouslyPricedResult(input({ running: true }), 5)).toEqual({ kind: "none", reason: MATCH_STATE_TEXT.running });
    expect(previouslyPricedResult(input({ run: null }), 5)).toEqual({ kind: "none", reason: "Matching not run yet" });
    expect(previouslyPricedResult(input({ run: null, failedReason: "the judge stopped" }), 5))
      .toEqual({ kind: "none", reason: "Matching failed: the judge stopped" });
    expect(previouslyPricedResult(input(), 6)).toEqual({ kind: "none", reason: "No earlier match found" });
    expect(previouslyPricedResult(input(), 99)).toEqual({ kind: "none", reason: "No earlier match found" });
    expect(previouslyPricedResult(input(), 7)).toEqual({ kind: "none", reason: "Matching failed: the call failed: timeout" });
  });

  it("a row with matches -> a decline CARRYING them, with the row's unit and its own row bound into the actions", async () => {
    const calls: number[] = [];
    const r = previouslyPricedResult(input({ actions: { ...ACTIONS, onUndo: async (_m, er) => { calls.push(er); } } }), 5);
    expect(r.kind).toBe("none");
    if (r.kind !== "none" || !r.matches) throw new Error("no matches");
    expect(r.matches.matches.map((m) => m.key)).toEqual(["a", "b"]);
    expect([r.matches.rowUnit, r.matches.excelRow, r.matches.matchRun]).toEqual(["No.", 5, "BRMR-1"]);
    await r.matches.onUndo(r.matches.matches[0]);
    expect(calls).toEqual([5]);
  });

  it("no value to Use and no badge (G4 (a)): the card never counts", () => {
    const h = makePreviouslyPricedHelper(input());
    expect(h.id).toBe(previouslyPricedHelper.id);
    expect(suggestionCountsByKind(CTX(5), ["supply_rate", "install_rate"], [h])).toEqual({ supply_rate: 0, install_rate: 0 });
  });

  it("buildHelperList: without the closure the static list is unchanged; with it, it takes the stub's place", () => {
    expect(buildHelperList(null)).toBe(RATE_HELPERS);
    expect(buildHelperList(null, null)).toBe(RATE_HELPERS);
    const h = makePreviouslyPricedHelper(input());
    expect(buildHelperList(null, h).map((x) => x.id)).toEqual(["previously_priced_boqs", "qty_breakdown_live"]);
    expect(buildHelperList(null, h)[0]).toBe(h);
  });
});

describe("the link (G14 (a)), prev / next, the payload levels", () => {
  it("?row= on the pricing route, names encoded", () => {
    expect(matchRowHref({ boq: "BOQ-26-00279", sheet_name: "Fire +Plumbing ", excel_row: 352 }))
      .toBe("/upload-boq/hub/BOQ-26-00279/pricing/Fire%20%2BPlumbing%20?row=352");
  });

  it("prev / next wrap round the shown matches", () => {
    expect([stepIndex(0, 5, -1), stepIndex(4, 5, 1), stepIndex(2, 5, 1), stepIndex(0, 1, 1)]).toEqual([4, 0, 3, 0]);
  });

  it("sheet -> section -> item group -> row, notes under each", () => {
    const lv = payloadLevels({
      id: 9, description: "4C x 16 sq.mm", notes: { appended: { D: "FRLS" } },
      ancestor_chain: [
        { relation: "sheet", description: "Elec BOQ" },
        { relation: "grandparent", distance: 2, description: "C. LT cables", notes: { attached: ["All cables FRLS"] } },
        { relation: "parent", distance: 1, description: "Supply of XLPE cables" },
      ],
    }, "Rm");
    expect(lv.map((l) => [l.tag, l.text, l.notes])).toEqual([
      ["Sheet", "Elec BOQ", []],
      ["Section", "C. LT cables", ["All cables FRLS"]],
      ["Item group", "Supply of XLPE cables", []],
      ["This row", "4C x 16 sq.mm  ·  Rm", ["FRLS"]],
    ]);
    expect(payloadLevels(null)).toEqual([]);
  });
});
