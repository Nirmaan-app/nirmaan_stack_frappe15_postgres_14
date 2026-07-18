import { describe, it, expect } from "vitest";
import {
  NEW_SHEET,
  UNDECIDED,
  initDecisions,
  isGeneralSpecsOriginal,
  claimedOriginals,
  duplicateClaims,
  unclaimedOriginals,
  isMappingComplete,
  toConfirmPayload,
  type CommittedSheet,
  type RevisedSheetProposal,
} from "./revisionMapping";

const committed: CommittedSheet[] = [
  { sheet_name: "Electrical", commit_version: 3, general_specs: false },
  { sheet_name: "Make List", commit_version: 1, general_specs: true },
];

const revised: RevisedSheetProposal[] = [
  { sheet_name: "Electrical", sheet_order: 1, proposed_source: "Electrical", status: "matched", general_specs: false },
  { sheet_name: "Make List", sheet_order: 2, proposed_source: "Make List", status: "matched", general_specs: true },
  { sheet_name: "Brand New", sheet_order: 3, proposed_source: null, status: "unmatched", general_specs: false },
];

describe("initDecisions", () => {
  it("pre-fills matched sheets and leaves unmatched undecided", () => {
    const d = initDecisions(revised);
    expect(d["Electrical"]).toEqual({ choice: "Electrical", general_specs: false });
    expect(d["Make List"]).toEqual({ choice: "Make List", general_specs: true });
    expect(d["Brand New"].choice).toBe(UNDECIDED);
  });
});

describe("isGeneralSpecsOriginal", () => {
  it("is true only for a general-specs committed original", () => {
    expect(isGeneralSpecsOriginal(committed, "Make List")).toBe(true);
    expect(isGeneralSpecsOriginal(committed, "Electrical")).toBe(false);
    expect(isGeneralSpecsOriginal(committed, NEW_SHEET)).toBe(false);
  });
});

describe("claimed / duplicate / unclaimed", () => {
  it("counts only real originals as claimed (not New / undecided)", () => {
    const d = initDecisions(revised); // Brand New still undecided
    expect(claimedOriginals(d).sort()).toEqual(["Electrical", "Make List"]);
  });

  it("flags a double-claimed original (1:1 violation)", () => {
    const d = {
      A: { choice: "Electrical", general_specs: false },
      B: { choice: "Electrical", general_specs: false },
    };
    expect(duplicateClaims(d)).toEqual(["Electrical"]);
  });

  it("lists originals no revised sheet claims", () => {
    const d = {
      Electrical: { choice: "Electrical", general_specs: false },
      Other: { choice: NEW_SHEET, general_specs: false },
    };
    expect(unclaimedOriginals(committed, d).map((c) => c.sheet_name)).toEqual(["Make List"]);
  });
});

describe("isMappingComplete", () => {
  it("is false while any sheet is undecided", () => {
    const d = initDecisions(revised); // Brand New undecided
    expect(isMappingComplete(revised, d)).toBe(false);
  });

  it("is true once every sheet is mapped or declared New with no duplicate", () => {
    const d = initDecisions(revised);
    d["Brand New"] = { choice: NEW_SHEET, general_specs: false };
    expect(isMappingComplete(revised, d)).toBe(true);
  });

  it("is false when an original is double-claimed even if all decided", () => {
    const d = {
      Electrical: { choice: "Electrical", general_specs: false },
      "Make List": { choice: "Electrical", general_specs: false },
      "Brand New": { choice: NEW_SHEET, general_specs: false },
    };
    expect(isMappingComplete(revised, d)).toBe(false);
  });
});

describe("toConfirmPayload", () => {
  it("emits entries in tab order with null source for New sheets", () => {
    const d = initDecisions(revised);
    d["Brand New"] = { choice: NEW_SHEET, general_specs: false };
    const payload = toConfirmPayload(revised, d);
    expect(payload).toEqual([
      { sheet_name: "Electrical", source_sheet_name: "Electrical", declared_new: false, general_specs: false },
      { sheet_name: "Make List", source_sheet_name: "Make List", declared_new: false, general_specs: true },
      { sheet_name: "Brand New", source_sheet_name: null, declared_new: true, general_specs: false },
    ]);
  });

  it("marks a New sheet declared_new and drops its general_specs", () => {
    const d = { X: { choice: NEW_SHEET, general_specs: true } };
    const r: RevisedSheetProposal[] = [
      { sheet_name: "X", sheet_order: 1, proposed_source: null, status: "unmatched", general_specs: false },
    ];
    expect(toConfirmPayload(r, d)[0]).toEqual({
      sheet_name: "X",
      source_sheet_name: null,
      declared_new: true,
      general_specs: false,
    });
  });
});
