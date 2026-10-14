import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CheckSummary } from "./boqTypes";
import {
  CARD_ALL_CHECKED,
  CARD_CHECK_INCOMPLETE,
  CARD_CHECK_INCOMPLETE_NOTE,
  CARD_NOT_CHECKED,
  SUMMARY_TO_CHECK_TITLE,
  anyCheckRunning,
  cardCheck,
  cardNotChecked,
  footerNotChecked,
  footerRowsToCheck,
  parseSummary,
  summaryReady,
} from "./hubCheckSummary";

/** One sheet's counts as review_flags.get_check_summary sends them. Default: checked, no flags. */
function summary(over: Partial<CheckSummary> = {}): CheckSummary {
  return {
    check_status: "done", check_running: false, to_check: 0,
    by_kind: { type: 0, parent: 0, both: 0 }, flagged_by_kind: { type: 0, parent: 0, both: 0 },
    checked: 0, flagged: 0, non_blank_rows: 38, flagged_pct: 0, heavy: false, open_rows: [],
    ...over,
  };
}

const RUNNING = summary({ check_status: "running", check_running: true, to_check: 7, flagged: 7 });
const SIX_OPEN = summary({ to_check: 6, flagged: 6, flagged_pct: 15.8 });
const ALL_CHECKED = summary({ to_check: 0, flagged: 6, checked: 6, flagged_pct: 15.8 });
const INCOMPLETE = summary({ check_status: "incomplete", to_check: 4, flagged: 4, non_blank_rows: 8, flagged_pct: 50, heavy: true });
const NOT_RUN = summary({ check_status: "not_run" });

describe("cardCheck (U3, U4, U5 -- the approved table)", () => {
  it("check running -> the chip and 'check in progress', no count", () => {
    expect(cardCheck("Parsed", RUNNING)).toEqual({
      chip: "Checking rows…", stageSub: "check in progress", lines: [], note: null,
    });
  });

  it("Parsed with open flags -> '[N] rows to check', with the server's number", () => {
    expect(cardCheck("Parsed", SIX_OPEN).lines).toEqual([{ text: "6 rows to check", tone: "attention" }]);
  });

  it("one open flag reads in the singular", () => {
    expect(cardCheck("Parsed", summary({ to_check: 1, flagged: 3 })).lines[0].text).toBe("1 row to check");
  });

  it("Parsed with every flag checked -> 'all flagged rows checked'", () => {
    expect(cardCheck("Parsed", ALL_CHECKED).lines).toEqual([{ text: CARD_ALL_CHECKED, tone: "ok" }]);
  });

  it("Finalized with flags -> 'all flagged rows checked'", () => {
    expect(cardCheck("Finalized", ALL_CHECKED).lines).toEqual([{ text: "all flagged rows checked", tone: "ok" }]);
  });

  it("no row was ever flagged -> nothing, Parsed or Finalized", () => {
    expect(cardCheck("Parsed", summary())).toEqual({ chip: null, stageSub: null, lines: [], note: null });
    expect(cardCheck("Finalized", summary()).lines).toEqual([]);
  });

  it("check incomplete on a Parsed sheet -> the tag, its sentence, and the rows still to check", () => {
    const card = cardCheck("Parsed", INCOMPLETE);
    expect(card.lines.map((l) => l.text)).toEqual([CARD_CHECK_INCOMPLETE, "4 rows to check"]);
    expect(card.note).toBe(
      "The automatic row check didn't finish on this sheet. Only the quantity / unit check ran. Re-parse to try again.",
    );
    expect(card.note).toBe(CARD_CHECK_INCOMPLETE_NOTE);
  });

  it("check incomplete on a Finalized sheet -> the tag only, no re-parse sentence", () => {
    const card = cardCheck("Finalized", summary({ check_status: "incomplete" }));
    expect(card.lines).toEqual([{ text: "check incomplete", tone: "attention" }]);
    expect(card.note).toBeNull();
  });

  it("a sheet parsed before the check existed -> nothing, exactly as before", () => {
    expect(cardCheck("Parsed", NOT_RUN)).toEqual({ chip: null, stageSub: null, lines: [], note: null });
    expect(cardCheck("Finalized", NOT_RUN).lines).toEqual([]);
  });

  it("says nothing before the counts are read, and nothing on a sheet that is not reviewable", () => {
    expect(cardCheck("Parsed", undefined).lines).toEqual([]);
    for (const status of ["Pending", "Config Done", "Parse failed", "Skip", "Hidden", "General specs"]) {
      expect(cardCheck(status, SIX_OPEN)).toEqual({ chip: null, stageSub: null, lines: [], note: null });
    }
  });
});

describe("footerRowsToCheck (U6)", () => {
  const sheets = { FPS: SIX_OPEN, "PA ": summary({ to_check: 4, flagged: 4 }), HVAC: ALL_CHECKED, Old: NOT_RUN };

  it("sums the server's rows-to-check over the Parsed sheets, VERBATIM names", () => {
    expect(footerRowsToCheck(["FPS", "PA ", "HVAC", "Old"], sheets)).toBe(" · 10 rows to check");
  });

  it("counts only the sheets it is given -- a Finalized sheet is not passed in", () => {
    expect(footerRowsToCheck(["FPS"], sheets)).toBe(" · 6 rows to check");
  });

  it("does not match a trimmed name (#152)", () => {
    expect(footerRowsToCheck(["PA"], sheets)).toBe("");
  });

  it("adds nothing at zero and before the counts are read", () => {
    expect(footerRowsToCheck(["HVAC", "Old"], sheets)).toBe("");
    expect(footerRowsToCheck(["FPS"], undefined)).toBe("");
  });

  it("reads one row in the singular", () => {
    expect(footerRowsToCheck(["A"], { A: summary({ to_check: 1, flagged: 1 }) })).toBe(" · 1 row to check");
  });

  it("leaves out a sheet whose check is still running -- its count is not settled", () => {
    expect(footerRowsToCheck(["FPS", "New"], { FPS: SIX_OPEN, New: RUNNING })).toBe(" · 6 rows to check");
    expect(footerRowsToCheck(["New"], { New: RUNNING })).toBe("");
  });
});

describe("parseSummary (U8)", () => {
  it("lists checked sheets, and one line per sheet with rows to check: N of M rows (P%)", () => {
    const out = parseSummary(["FPS", "HVAC"], { FPS: SIX_OPEN, HVAC: summary({ non_blank_rows: 222 }) });
    expect(out.checkedLine).toBe("Parsed and checked: FPS, HVAC");
    expect(out.toCheckLines).toEqual(["FPS 6 of 38 rows (15.8%)"]);
    expect(out.parsedLine).toBeNull();
    expect(out.incompleteLines).toEqual([]);
  });

  it("adds 'review the whole sheet' only where the server calls the sheet heavy", () => {
    const heavy = summary({ to_check: 5, flagged: 5, non_blank_rows: 8, flagged_pct: 62.5, heavy: true });
    expect(parseSummary(["UPS"], { UPS: heavy }).toCheckLines).toEqual([
      "UPS 5 of 8 rows (62.5%) - review the whole sheet",
    ]);
  });

  it("names a sheet whose check did not finish, and still lists its rows to check", () => {
    const out = parseSummary(["UPS"], { UPS: INCOMPLETE });
    expect(out.checkedLine).toBeNull();
    expect(out.incompleteLines).toEqual([
      "Check didn't finish: UPS - only the quantity / unit check ran. Re-parse the sheet to try again.",
    ]);
    expect(out.toCheckLines).toEqual(["UPS 4 of 8 rows (50%) - review the whole sheet"]);
  });

  it("falls back to the old 'Parsed:' line for a sheet with no counts; a not-run sheet has its own line", () => {
    // INVERTED in S6 (U1, owner rulings V1 / Q-i). Was: expect(parseSummary(["A", "B"], { A: NOT_RUN })
    // .parsedLine).toBe("Parsed: A, B") -- a sheet whose check never ran sat under "Parsed:".
    const out = parseSummary(["A", "B"], { A: NOT_RUN });
    expect(out.parsedLine).toBe("Parsed: B");
    expect(out.notCheckedLine).toBe("Parsed, not checked: A");
    // Negative half kept: a sheet with no counts at all still falls back to "Parsed:".
    expect(parseSummary(["A"], undefined)).toEqual({
      checkedLine: null, parsedLine: "Parsed: A", notCheckedLine: null, toCheckLines: [], incompleteLines: [],
    });
  });

  it("shows a trimmed name but looks the sheet up by its VERBATIM name (#152)", () => {
    const out = parseSummary(["PA "], { "PA ": SIX_OPEN });
    expect(out.checkedLine).toBe("Parsed and checked: PA");
    expect(out.toCheckLines[0].startsWith("PA 6 of 38 rows")).toBe(true);
  });

  it("covers only the sheets this parse parsed", () => {
    expect(parseSummary(["FPS"], { FPS: SIX_OPEN, Other: SIX_OPEN }).toCheckLines).toHaveLength(1);
  });

  it("is empty when nothing was parsed", () => {
    expect(parseSummary([], { FPS: SIX_OPEN })).toEqual({
      checkedLine: null, parsedLine: null, notCheckedLine: null, toCheckLines: [], incompleteLines: [],
    });
    expect(SUMMARY_TO_CHECK_TITLE).toBe("Rows to check before finalizing");
  });
});

describe("summaryReady (Q-c)", () => {
  it("holds the summary while any sheet this parse parsed is being checked", () => {
    expect(summaryReady(["FPS", "HVAC"], { FPS: RUNNING, HVAC: SIX_OPEN })).toBe(false);
  });

  it("opens once none of them is", () => {
    expect(summaryReady(["FPS", "HVAC"], { FPS: SIX_OPEN, HVAC: INCOMPLETE })).toBe(true);
  });

  it("ignores a check running on a sheet this parse did not parse", () => {
    expect(summaryReady(["FPS"], { FPS: SIX_OPEN, Other: RUNNING })).toBe(true);
  });

  it("opens at once when nothing was parsed", () => {
    expect(summaryReady([], undefined)).toBe(true);
  });

  it("holds until the counts have been read", () => {
    expect(summaryReady(["FPS"], undefined)).toBe(false);
  });
});

describe("anyCheckRunning", () => {
  it("is true when any sheet's check runs, false otherwise", () => {
    expect(anyCheckRunning({ A: SIX_OPEN, B: RUNNING })).toBe(true);
    expect(anyCheckRunning({ A: SIX_OPEN })).toBe(false);
    expect(anyCheckRunning(undefined)).toBe(false);
  });
});

// The hub and the dialog are not mounted here; these read their source for the wiring.
// They cover BoqHubPage.tsx, SheetCard.tsx and ParseRunDialog.tsx only.
describe("hub source (U3-U8)", () => {
  const hub = readFileSync(join(__dirname, "BoqHubPage.tsx"), "utf8");
  const card = readFileSync(join(__dirname, "SheetCard.tsx"), "utf8");
  const dialog = readFileSync(join(__dirname, "ParseRunDialog.tsx"), "utf8");

  it("the hub reads the counts from S3's get_check_summary and from nowhere else", () => {
    expect(hub).toContain('"nirmaan_stack.api.boq.wizard.review_flags.get_check_summary"');
    expect(hub).toContain("checkSummary={checkSheets?.[draft.sheet_name]}");
    expect(card).toContain("cardCheck(effectiveStatus, checkSummary)");
  });

  it("the summary is held until the checks end, then built from the server's counts", () => {
    expect(hub).toContain("summaryReady(pendingParse.parsed, sheets)");
    expect(hub).toContain("check: parseSummary(parsed, sheets)");
  });

  it("the parse dialog says the rows are checked automatically, in both of its steps (U7)", () => {
    const sentence = /Each sheet is parsed and then its rows are checked automatically\.\s+This runs in the background and can take up to ~15 minutes on\s+large workbooks\. You can keep working; you'll see a summary here\s+when it's done\./g;
    expect(dialog.match(sentence)).toHaveLength(2);
    expect(dialog).not.toContain("~10 minutes");
  });
});

// ── S6 (U1, owner rulings V1 / Q-i): "not checked" only while the sheet changed since its commit ──
describe("not checked (S6 U1)", () => {
  it("a Parsed or Finalized sheet whose check never ran, never committed or re-parsed since -> 'not checked'", () => {
    expect(CARD_NOT_CHECKED).toBe("not checked");
    expect(cardNotChecked("Parsed", NOT_RUN, true)).toEqual({ text: "not checked", tone: "attention" });
    expect(cardNotChecked("Finalized", NOT_RUN, true)).toEqual({ text: "not checked", tone: "attention" });
  });

  it("nothing for a committed sheet unchanged since, a checked sheet, a running check or no counts", () => {
    expect(cardNotChecked("Finalized", NOT_RUN, false)).toBeNull();
    expect(cardNotChecked("Parsed", SIX_OPEN, true)).toBeNull();
    expect(cardNotChecked("Parsed", INCOMPLETE, true)).toBeNull();
    expect(cardNotChecked("Parsed", { ...NOT_RUN, check_running: true }, true)).toBeNull();
    expect(cardNotChecked("Config Done", NOT_RUN, true)).toBeNull();
    expect(cardNotChecked("Parsed", undefined, true)).toBeNull();
  });

  it("the footer counts only not-run sheets that changed since their commit", () => {
    const sheets = { A: NOT_RUN, "B ": NOT_RUN, C: SIX_OPEN };
    expect(footerNotChecked(["A", "B ", "C"], sheets, new Set(["A", "B ", "C"]))).toBe(" · 2 not checked");
    expect(footerNotChecked(["A", "B ", "C"], sheets, new Set(["A"]))).toBe(" · 1 not checked");
    expect(footerNotChecked(["A", "B ", "C"], sheets, new Set())).toBe("");
    expect(footerNotChecked(["A"], undefined, new Set(["A"]))).toBe("");
  });

  it("the hub and the card wire it in (source)", () => {
    const hub = readFileSync(join(__dirname, "BoqHubPage.tsx"), "utf8");
    const card = readFileSync(join(__dirname, "SheetCard.tsx"), "utf8");
    expect(hub).toContain("footerNotChecked(reviewableDrafts.map((d) => d.sheet_name), checkSheets, changedSheets)");
    expect(hub).toContain("parseResult.check.notCheckedLine");
    expect(card).toContain("cardNotChecked(effectiveStatus, checkSummary, !!changedSinceCommit)");
  });
});
