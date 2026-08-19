// Unit tests for the INTERNAL export dialog's PURE helpers (BCS-EXP-4): who may see the action,
// the per-sheet cost-tracking badge, and the results summary. No DOM.
import { describe, expect, it } from "vitest";
import {
  BCS_EXPORT_COPY,
  bcsBadgeLabel,
  canDownloadBcsExport,
  summariseCostBlocks,
} from "./PricedTenderBcsDialog";
import type { CommittedSheetState, ExportPricedBcsWorkbookResponse } from "./boqTypes";

const sheet = (over: Partial<CommittedSheetState> = {}): CommittedSheetState => ({
  sheet_name: "Elec ",
  committed_at: "2026-08-19 10:00:00",
  commit_version: 1,
  sheet_order: 1,
  sheet_disposition: "grid_and_nodes",
  ...over,
});

const result = (over: Partial<ExportPricedBcsWorkbookResponse> = {}) =>
  ({
    filename: "x_priced_bcs_internal_20260819.xlsx",
    content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    content_base64: "",
    exported_sheets: ["Elec "],
    skipped_formula_columns: {},
    remark_columns: {},
    cost_blocks: {},
    cost_skipped: {},
    ...over,
  }) as ExportPricedBcsWorkbookResponse;

describe("canDownloadBcsExport -- who may see the internal export", () => {
  it("admits the Administrator user and both entitled profiles", () => {
    expect(canDownloadBcsExport("anything", "Administrator")).toBe(true);
    expect(canDownloadBcsExport("Nirmaan Admin Profile", "a@b.com")).toBe(true);
    expect(canDownloadBcsExport("Nirmaan Estimates Executive Profile", "a@b.com")).toBe(true);
  });

  it("refuses every other role", () => {
    for (const role of [
      "Nirmaan Project Lead Profile",
      "Nirmaan PMO Executive Profile",
      "Nirmaan Procurement Executive Profile",
      "Nirmaan Accountant Profile",
      "",
    ]) {
      expect(canDownloadBcsExport(role, "a@b.com"), role).toBe(false);
    }
  });

  it("★ refuses while the role is still resolving, so the action never flashes in", () => {
    // `useUserData` returns these literals while the Nirmaan Users doc is in flight. Without
    // the guard an entitled user watches the item appear and vanish -- the exact reason
    // canAdminOverride carries the same check.
    expect(canDownloadBcsExport("Loading", "a@b.com")).toBe(false);
    expect(canDownloadBcsExport("Error", "a@b.com")).toBe(false);
  });

  it("★ still refuses a resolving role for a NON-Administrator only", () => {
    // Administrator is decided by user_id, not role, so it must survive the sentinel -- the
    // server admits it on the same basis.
    expect(canDownloadBcsExport("Loading", "Administrator")).toBe(false);
  });
});

describe("bcsBadgeLabel -- a badge, never a gate", () => {
  it("says cost tracking is on or off", () => {
    expect(bcsBadgeLabel(sheet({ bcs_enabled: true }))).toBe(BCS_EXPORT_COPY.bcsOn);
    expect(bcsBadgeLabel(sheet({ bcs_enabled: false }))).toBe(BCS_EXPORT_COPY.bcsOff);
  });

  it("treats an absent flag as off rather than blank", () => {
    // The field is additive, so an older payload can omit it. A missing badge would read as
    // "we don't know", which is not a state this picker has.
    expect(bcsBadgeLabel(sheet())).toBe(BCS_EXPORT_COPY.bcsOff);
  });

  it("★ says nothing on a grid-only sheet, which already says 'no rates to write'", () => {
    // Two absence notes on one row read as a contradiction.
    expect(bcsBadgeLabel(sheet({ sheet_disposition: "grid_only", bcs_enabled: false }))).toBeNull();
    expect(bcsBadgeLabel(sheet({ sheet_disposition: "grid_only", bcs_enabled: true }))).toBeNull();
  });
});

describe("summariseCostBlocks -- the report", () => {
  it("names where each block landed", () => {
    const { written } = summariseCostBlocks(
      result({
        cost_blocks: {
          "Elec ": { cost_columns: { supply: "G", install: "H" }, total_column: "I",
            margin_column: "J", margin_skipped: null, rows: 3 },
        },
      }),
    );
    expect(written).toEqual(["Elec: 3 costed rows in G, H, total in I, margin in J"]);
  });

  it("says 'row' for one and 'rows' for several", () => {
    const one = summariseCostBlocks(
      result({ cost_blocks: { S: { cost_columns: { combined: "G" }, total_column: "H",
            margin_column: "I", margin_skipped: null, rows: 1 } } }),
    );
    expect(one.written[0]).toContain("1 costed row in");
    expect(one.written[0]).not.toContain("1 costed rows");
  });

  it("omits the total clause when no Total column was written", () => {
    const { written } = summariseCostBlocks(
      result({ cost_blocks: { S: { cost_columns: { supply: "G" }, total_column: null,
            margin_column: null, margin_skipped: "no total to measure", rows: 2 } } }),
    );
    expect(written[0]).toBe("S: 2 costed rows in G, no margin -- no total to measure");
  });

  it("names the margin column when one was written", () => {
    const { written } = summariseCostBlocks(
      result({
        cost_blocks: {
          S: {
            cost_columns: { supply: "G", install: "H" },
            total_column: "I",
            margin_column: "J",
            margin_skipped: null,
            rows: 2,
          },
        },
      }),
    );
    expect(written[0]).toBe("S: 2 costed rows in G, H, total in I, margin in J");
  });

  it("★ reports a SKIPPED margin with its reason, in the sheet's own line", () => {
    // ⚠️ THIS SHEET IS ABSENT FROM `cost_skipped` -- it got a cost block and a Total, so it
    // is not a skipped block. Nothing else in the report would mention the missing column,
    // and on an internal cost file a silently absent margin reads as "we could not be
    // bothered" rather than "there is no amount on this sheet to measure against".
    //
    // The server's sentence is passed through VERBATIM: three different reasons reach here
    // and only the server knows which applied. Re-wording it client-side would be a fourth
    // voice for the same fact.
    const { written, skipped } = summariseCostBlocks(
      result({
        cost_blocks: {
          S: {
            cost_columns: { supply: "G" },
            total_column: "H",
            margin_column: null,
            margin_skipped: "this sheet maps no amount column, so there is nothing to measure a margin against",
            rows: 1,
          },
        },
      }),
    );
    expect(written[0]).toContain("total in H");
    expect(written[0]).toContain(
      "no margin -- this sheet maps no amount column, so there is nothing to measure a margin against",
    );
    expect(skipped, "a missing margin is NOT a skipped sheet").toEqual([]);
  });

  it("says nothing about the margin when the server sent neither key", () => {
    // A pre-slice-6 payload, or any shape that simply does not answer. Absent must read as
    // "no information", never as "no margin" -- inventing a refusal is worse than silence.
    const { written } = summariseCostBlocks(
      result({
        cost_blocks: {
          // The cast is the POINT, not a convenience: the current server always sends both
          // margin keys, so this shape is unreachable today and the type says so. It is
          // constructed deliberately to prove the reader treats absence as "no information"
          // rather than inventing a refusal from it.
          S: { cost_columns: { supply: "G" }, total_column: "H", rows: 1 } as unknown as
            ExportPricedBcsWorkbookResponse["cost_blocks"][string],
        },
      }),
    );
    expect(written[0]).toBe("S: 1 costed row in G, total in H");
  });

  it("★ reports every skipped sheet WITH its reason", () => {
    // On a cost file a silently absent block reads as "this sheet costs nothing" rather than
    // "this sheet was never costed" -- an absence presented as a claim.
    const { skipped } = summariseCostBlocks(
      result({ cost_skipped: { "Specs ": "this is a general-specs sheet, which carries no priced rows" } }),
    );
    expect(skipped).toEqual([
      "Specs: this is a general-specs sheet, which carries no priced rows",
    ]);
  });

  it("survives a payload carrying neither map", () => {
    const bare = { ...result() } as ExportPricedBcsWorkbookResponse;
    delete (bare as Partial<ExportPricedBcsWorkbookResponse>).cost_blocks;
    delete (bare as Partial<ExportPricedBcsWorkbookResponse>).cost_skipped;
    expect(summariseCostBlocks(bare)).toEqual({ written: [], skipped: [] });
  });

  it("trims a sheet name for DISPLAY only", () => {
    // #152: names are matched VERBATIM everywhere, and trimmed only where a human reads them.
    const { written } = summariseCostBlocks(
      result({
        cost_blocks: {
          "HVAC ": {
            cost_columns: { supply: "G" },
            total_column: "H",
            margin_column: "I",
            margin_skipped: null,
            rows: 1,
          },
        },
      }),
    );
    expect(written[0].startsWith("HVAC:")).toBe(true);
  });
});

describe("the copy", () => {
  it("★ says the margin is LIVE, and names what blanks it, BEFORE the download", () => {
    // ⚠️ THIS TEST REVERSED AT SLICE 6, and the reversal is the record of a ruling rather
    // than a wording nit. It used to assert the panel told the user to "add a % Margin column
    // in Excel", because the column did not ship. It does now, so that sentence would be an
    // instruction to duplicate a column that is already there.
    //
    // What the panel owes the reader changed with it. The figures are FORMULAS, not pasted
    // numbers -- so an edit anywhere in the file moves them -- and a blank margin needs an
    // explanation the workbook cannot give in a tooltip. Both are said here, before the
    // download, because afterwards is after the person has already wondered.
    const body = BCS_EXPORT_COPY.marginBody.toLowerCase();
    expect(BCS_EXPORT_COPY.marginTitle).toContain("% Margin");
    expect(body).toContain("formula");
    expect(body).toContain("blank");
    expect(body).toContain("negative");
    expect(body, "the panel must no longer tell the user to add the column themselves")
      .not.toContain("add a % margin column");
  });

  it("names % Margin in the description, alongside the other two column families", () => {
    // The description lists what the file carries. A column that ships but goes unmentioned
    // is one a user has to discover by scrolling to the right-hand edge of a sheet.
    const d = BCS_EXPORT_COPY.description.toLowerCase();
    expect(d).toContain("cost");
    expect(d).toContain("bcs total amount");
    expect(d).toContain("% margin");
  });

  it("says out loud that the file is internal", () => {
    expect(BCS_EXPORT_COPY.description.toLowerCase()).toContain("internal");
    expect(BCS_EXPORT_COPY.description.toLowerCase()).toContain("costs us");
  });
});
