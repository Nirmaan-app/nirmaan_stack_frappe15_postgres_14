import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COMMIT_DIALOG_DESCRIPTION,
  SUBTITLE_COMMITTED,
  SUBTITLE_MAP,
  SUBTITLE_READY,
  SUBTITLE_REVIEW,
  changedSinceCommit,
  footerSetUp,
  hubSubtitle,
  preselectedSheets,
  reparsedAfterCommitLine,
  reparsedAfterLabel,
  setUpCount,
  sheetsChangedSinceCommit,
} from "./hubState";

// The two timestamps as the server writes them (frappe.utils.now()).
const V1_AT = "2026-10-14 20:05:09.023146";
const BEFORE = "2026-10-14 19:56:18.039224";
const AFTER = "2026-10-14 20:19:02.905851";

describe("changed since its last commit (S6 F12, Q-f / Q-i)", () => {
  it("never committed -> changed", () => {
    expect(changedSinceCommit(BEFORE, undefined, false)).toBe(true);
    expect(changedSinceCommit(null, null, false)).toBe(true);
  });

  it("re-parsed after the commit -> changed; parsed before it -> not (S5 BOQ-26-00650: FAPA / FPS)", () => {
    expect(changedSinceCommit(AFTER, V1_AT, true)).toBe(true);
    expect(changedSinceCommit(BEFORE, V1_AT, true)).toBe(false);
  });

  it("committed with no parse time (a general-specs sheet) -> not changed", () => {
    expect(changedSinceCommit(null, V1_AT, true)).toBe(false);
  });

  it("collects the changed sheets by VERBATIM name (#152)", () => {
    const drafts = [
      { sheet_name: "FPS ", last_parsed_at: AFTER },
      { sheet_name: "FAPA", last_parsed_at: BEFORE },
      { sheet_name: "New", last_parsed_at: AFTER },
    ];
    const committed = new Map([["FPS ", { committed_at: V1_AT }], ["FAPA", { committed_at: V1_AT }]]);
    expect([...sheetsChangedSinceCommit(drafts, committed)].sort()).toEqual(["FPS ", "New"]);
  });
});

describe("hub subtitle (S6 U4)", () => {
  const st = (pairs: [string, string][]) => pairs.map(([sheet_name, status]) => ({ sheet_name, status }));

  it("nothing parsed -> map sheets (the old text)", () => {
    expect(hubSubtitle({ statuses: st([["A", "Config Done"], ["B", "Pending"]]), changed: new Set(["A", "B"]), committedCount: 0 }))
      .toBe("Map sheets before parsing");
    expect(SUBTITLE_MAP).toBe("Map sheets before parsing");
  });

  it("a Parsed sheet -> review parsed sheets", () => {
    expect(hubSubtitle({ statuses: st([["A", "Parsed"], ["B", "Finalized"]]), changed: new Set(["A", "B"]), committedCount: 1 }))
      .toBe(SUBTITLE_REVIEW);
    expect(SUBTITLE_REVIEW).toBe("Review parsed sheets");
  });

  it("finalized and changed since commit -> ready to commit", () => {
    expect(hubSubtitle({ statuses: st([["A", "Finalized"]]), changed: new Set(["A"]), committedCount: 0 })).toBe(SUBTITLE_READY);
    expect(SUBTITLE_READY).toBe("Ready to commit");
  });

  it("every finalized sheet committed and unchanged -> committed (S5 DEF-05: not 'Map sheets')", () => {
    expect(hubSubtitle({ statuses: st([["A", "Finalized"], ["B", "Finalized"]]), changed: new Set(), committedCount: 2 }))
      .toBe(SUBTITLE_COMMITTED);
    expect(SUBTITLE_COMMITTED).toBe("Committed");
  });
});

describe("hub footer set-up count (S6 U4)", () => {
  it("counts Config Done, Parsed and Finalized; not Pending / Parse failed", () => {
    expect(setUpCount(["Config Done", "Parsed", "Finalized", "Pending", "Parse failed"])).toBe(3);
    expect(footerSetUp(2, 2)).toBe("2 of 2 data sheets set up");
    expect(footerSetUp(1, 1)).toBe("1 of 1 data sheet set up");
  });

  it("the hub uses it; 'reviewed' and 'checked' are gone from the footer; the parse gate is untouched (source)", () => {
    const hub = readFileSync(join(__dirname, "BoqHubPage.tsx"), "utf8");
    expect(hub).toContain("footerSetUp(setUpTotal, totalDataCount)");
    expect(hub).toContain("` · ${parsedCheckDoneCount} finalized`");
    expect(hub).not.toContain("` · ${parsedCheckDoneCount} checked`");
    expect(hub).not.toContain("data ${totalDataCount === 1 ? \"sheet\" : \"sheets\"} reviewed`");
    expect(hub).toContain("const canParse = reviewedCount >= 1;");
    expect(hub).toContain('"Cloned from template — review, commit & price" : hubStage');
  });
});

describe("commit line and commit dialog (S6 U10)", () => {
  it("the approved words", () => {
    expect(reparsedAfterCommitLine(1)).toBe("Re-parsed after v1 — tendering still uses v1. Finalize and commit to update it.");
    expect(reparsedAfterLabel(2)).toBe("re-parsed after v2");
    expect(COMMIT_DIALOG_DESCRIPTION).toBe(
      "Sheets never committed, or re-parsed since their last commit, are selected. Tick any other sheet to commit it again.",
    );
  });

  it("pre-selects only the changed eligible sheets (S5: FPS unchanged was re-committed as v2)", () => {
    const eligible = [{ sheet_name: "FPS " }, { sheet_name: "FAPA" }];
    expect([...preselectedSheets(eligible, new Set(["FAPA"]))]).toEqual(["FAPA"]);
    expect([...preselectedSheets(eligible, new Set())]).toEqual([]);
    expect([...preselectedSheets(eligible, new Set(["Other"]))]).toEqual([]);
  });

  it("the dialog and the card use them; the dialog no longer ticks every eligible sheet (source)", () => {
    const dialog = readFileSync(join(__dirname, "CommitDialog.tsx"), "utf8");
    const card = readFileSync(join(__dirname, "SheetCard.tsx"), "utf8");
    expect(dialog).toContain("preselectedSheets(eligibleSheets, changedSinceCommit)");
    expect(dialog).not.toContain("new Set(eligibleSheets.map((s) => s.sheet_name))");
    expect(dialog).toContain("{COMMIT_DIALOG_DESCRIPTION}");
    expect(dialog).toContain('"nirmaan_stack.api.boq.wizard.commit_pipeline.commit_boq"');
    expect(card).toContain("reparsedAfterCommitLine(committedState.commit_version)");
    expect(card).toContain("Ready for tendering &mdash; click Tendering below.");
  });
});
