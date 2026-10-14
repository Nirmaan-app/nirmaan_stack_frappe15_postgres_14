import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CheckSummary, RowCheckFlags } from "./boqTypes";
import {
  CHECK_FILTERS,
  CHECK_FILTER_LABELS,
  CHECK_REASON_LINES,
  CHECK_RUNNING_MESSAGE,
  CHECKING_ROWS_LABEL,
  CHECK_INCOMPLETE_BANNER,
  REPARSE_SHEET_LABEL,
  REVERT_FAILED_MESSAGE,
  REVERT_HINT,
  REVERT_LABEL,
  SUGGESTED_LABEL,
  checkCounter,
  checkPill,
  checkReasonLines,
  finalizeBlockMessage,
  heavyBannerText,
  isCheckIncomplete,
  isCheckOpen,
  isCheckRunning,
  isRowFlagged,
  matchesCheckFilter,
  orderWithSuggestion,
  pctText,
  revertMessageLines,
  suggestedParentLine,
  suggestionFor,
  type CheckFilter,
} from "./reviewCheckFlags";

/** A row's flags as the server sends them. Default: never flagged. */
function flags(over: Partial<RowCheckFlags> = {}): RowCheckFlags {
  return {
    check_type: false, check_parent: false, reasons: [], doubts: [],
    looks_ok: false, checked: false, ...over,
  };
}

const OPEN_TYPE = flags({ check_type: true, reasons: ["type_doubt"], doubts: ["type_doubt"] });
const OPEN_PARENT = flags({ check_parent: true, reasons: ["parent_doubt"], doubts: ["parent_doubt"] });
const OPEN_BOTH = flags({
  check_type: true, check_parent: true,
  reasons: ["unit_qty_not_item", "parent_doubt"], doubts: ["unit_qty_not_item", "parent_doubt"],
});
/** Was "Check both"; the user changed the type, the parent flag is still open. */
const BOTH_TYPE_FIXED = flags({
  check_parent: true, reasons: ["parent_doubt"], doubts: ["type_doubt", "parent_doubt"],
});
const TICKED = flags({ doubts: ["type_doubt"], looks_ok: true, checked: true });
const FIXED_TYPE = flags({ doubts: ["type_doubt"], checked: true });
const FIXED_PARENT = flags({ doubts: ["parent_doubt"], checked: true });
const FIXED_BOTH = flags({ doubts: ["type_doubt", "unit_qty_not_item", "parent_doubt"], checked: true });

function summary(over: Partial<CheckSummary> = {}): CheckSummary {
  return {
    check_status: "done", check_running: false, to_check: 0,
    by_kind: { type: 0, parent: 0, both: 0 }, flagged_by_kind: { type: 0, parent: 0, both: 0 },
    checked: 0, flagged: 0, non_blank_rows: 38, flagged_pct: 0, heavy: false, open_rows: [],
    ...over,
  };
}

describe("checkPill", () => {
  it("shows nothing on a row that was never flagged", () => {
    expect(checkPill(flags())).toBeNull();
    expect(checkPill(null)).toBeNull();
    expect(checkPill(undefined)).toBeNull();
  });

  it("names the open kind", () => {
    expect(checkPill(OPEN_TYPE)).toEqual({ label: "Check type", state: "open" });
    expect(checkPill(OPEN_PARENT)).toEqual({ label: "Check parent", state: "open" });
    expect(checkPill(OPEN_BOTH)).toEqual({ label: "Check both", state: "open" });
  });

  it("turns Check both into the single kind that remains once the other is answered", () => {
    expect(checkPill(BOTH_TYPE_FIXED)).toEqual({ label: "Check parent", state: "open" });
  });

  it("shows Checked for a Looks OK row", () => {
    expect(checkPill(TICKED)).toEqual({ label: "Checked", state: "checked" });
  });

  it("strikes through the kind that was flagged once the user's change answered it", () => {
    expect(checkPill(FIXED_TYPE)).toEqual({ label: "Check type", state: "struck" });
    expect(checkPill(FIXED_PARENT)).toEqual({ label: "Check parent", state: "struck" });
    expect(checkPill(FIXED_BOTH)).toEqual({ label: "Check both", state: "struck" });
  });

  it("an open flag wins over a tick that no longer covers it", () => {
    // The server only reports a flag open when the tick does not hold; draw what it says.
    expect(checkPill({ ...OPEN_TYPE, looks_ok: true })?.state).toBe("open");
  });

  it("reads openness and flagged-ness from the server's fields alone", () => {
    expect(isCheckOpen(OPEN_BOTH)).toBe(true);
    expect(isCheckOpen(TICKED)).toBe(false);
    expect(isCheckOpen(null)).toBe(false);
    expect(isRowFlagged(TICKED)).toBe(true);
    expect(isRowFlagged(flags())).toBe(false);
  });
});

describe("checkReasonLines", () => {
  it("words the three reason codes exactly as approved", () => {
    expect(CHECK_REASON_LINES).toEqual({
      type_doubt: "Row type may be wrong",
      unit_qty_not_item: "Has a unit or quantity but isn't an Item",
      parent_doubt: "Parent may be wrong",
    });
  });

  it("gives one line per open reason, in the server's order", () => {
    expect(checkReasonLines(flags({ reasons: ["type_doubt", "unit_qty_not_item", "parent_doubt"] })))
      .toEqual(["Row type may be wrong", "Has a unit or quantity but isn't an Item", "Parent may be wrong"]);
  });

  it("never shows a code: an unknown one gives no line", () => {
    const lines = checkReasonLines(flags({ reasons: ["some_new_code", "parent_doubt"] }));
    expect(lines).toEqual(["Parent may be wrong"]);
    expect(lines.join(" ")).not.toMatch(/_/);
  });

  it("reads the OPEN reasons, not everything that once applied", () => {
    expect(checkReasonLines(BOTH_TYPE_FIXED)).toEqual(["Parent may be wrong"]);
    expect(checkReasonLines(TICKED)).toEqual([]);
    expect(checkReasonLines(null)).toEqual([]);
  });

  it("names no AI in any line", () => {
    for (const line of Object.values(CHECK_REASON_LINES)) {
      expect(line).not.toMatch(/\bAI\b|Claude|Gemini|suggest/i);
    }
  });
});

describe("matchesCheckFilter", () => {
  const ROWS: Record<string, RowCheckFlags> = {
    never: flags(), type: OPEN_TYPE, parent: OPEN_PARENT, both: OPEN_BOTH,
    bothTypeFixed: BOTH_TYPE_FIXED, ticked: TICKED, fixed: FIXED_PARENT,
  };
  const under = (filter: CheckFilter) =>
    Object.keys(ROWS).filter((key) => matchesCheckFilter(ROWS[key], filter));

  it("offers the five approved options, in order", () => {
    expect(CHECK_FILTERS.map((f) => CHECK_FILTER_LABELS[f]))
      .toEqual(["Show all rows", "To check", "Check type", "Check parent", "Checked"]);
  });

  it("Show all rows hides nothing", () => {
    expect(under("all")).toEqual(Object.keys(ROWS));
    expect(matchesCheckFilter(null, "all")).toBe(true);
  });

  it("To check = every row with a flag still open", () => {
    expect(under("to_check")).toEqual(["type", "parent", "both", "bothTypeFixed"]);
  });

  it("a Check both row appears under Check type and under Check parent", () => {
    expect(under("type")).toEqual(["type", "both"]);
    expect(under("parent")).toEqual(["parent", "both", "bothTypeFixed"]);
  });

  it("Checked = flagged rows with nothing open, ticked or fixed", () => {
    expect(under("checked")).toEqual(["ticked", "fixed"]);
  });

  it("a row with no flag data is under no narrowing option", () => {
    for (const filter of ["to_check", "type", "parent", "checked"] as const) {
      expect(matchesCheckFilter(undefined, filter)).toBe(false);
    }
  });

  it("the options add up to the server's counts", () => {
    // 2 type-only, 3 parent-only, 1 both, 4 checked -- as review_flags.summarize would count them.
    const rows = [OPEN_TYPE, OPEN_TYPE, OPEN_PARENT, OPEN_PARENT, OPEN_PARENT, OPEN_BOTH,
      TICKED, TICKED, FIXED_TYPE, FIXED_BOTH, flags(), flags()];
    const count = (filter: CheckFilter) => rows.filter((r) => matchesCheckFilter(r, filter)).length;
    const s = summary({ to_check: 6, by_kind: { type: 2, parent: 3, both: 1 }, checked: 4, flagged: 10 });
    expect(count("to_check")).toBe(s.to_check);
    expect(count("type")).toBe(s.by_kind.type + s.by_kind.both);
    expect(count("parent")).toBe(s.by_kind.parent + s.by_kind.both);
    expect(count("checked")).toBe(s.checked);
  });
});

describe("checkCounter", () => {
  it("shows no strip on a sheet with no flags", () => {
    expect(checkCounter(summary())).toBeNull();
    expect(checkCounter(summary({ check_status: "not_run" }))).toBeNull();
    expect(checkCounter(null)).toBeNull();
    expect(checkCounter(undefined)).toBeNull();
  });

  it("counts the rows left, by kind, and the rows checked", () => {
    const counter = checkCounter(summary({
      to_check: 6, by_kind: { type: 1, parent: 5, both: 0 }, checked: 2, flagged: 8,
      flagged_by_kind: { type: 2, parent: 6, both: 0 },
    }));
    expect(counter).toEqual({
      state: "open",
      title: "6 rows to check",
      detail: "Row type 1 · Parent 5 · Both 0 · 2 checked",
      hint: "Fix the row type or parent, or tick Looks OK. Each row must be checked before finalizing.",
      buttonLabel: "Filter to these rows",
      buttonFilter: "to_check",
    });
  });

  it("turns green when every flagged row is checked, and says what was flagged", () => {
    const counter = checkCounter(summary({
      to_check: 0, checked: 6, flagged: 6, flagged_by_kind: { type: 1, parent: 5, both: 0 },
    }));
    expect(counter).toEqual({
      state: "done",
      title: "All 6 flagged rows checked",
      detail: "Row type 1 · Parent 5 · Both 0",
      hint: null,
      buttonLabel: "Show checked rows",
      buttonFilter: "checked",
    });
  });

  it("takes every number from the server's summary", () => {
    const counter = checkCounter(summary({
      to_check: 3, by_kind: { type: 7, parent: 8, both: 9 }, checked: 11, flagged: 14,
    }));
    expect(counter?.title).toBe("3 rows to check");
    expect(counter?.detail).toBe("Row type 7 · Parent 8 · Both 9 · 11 checked");
  });

  it("reads one row in the singular", () => {
    expect(checkCounter(summary({ to_check: 1, flagged: 1, by_kind: { type: 1, parent: 0, both: 0 } }))?.title)
      .toBe("1 row to check");
    expect(checkCounter(summary({ flagged: 1, checked: 1 }))?.title).toBe("All 1 flagged row checked");
  });

  it("falls back to the open kinds on a reply without the all-rows kinds", () => {
    const old = summary({ flagged: 2, checked: 2 });
    delete old.flagged_by_kind;
    expect(checkCounter(old)?.detail).toBe("Row type 0 · Parent 0 · Both 0");
  });
});

describe("isCheckRunning", () => {
  it("is running when either the sheet's flag or the run log says so", () => {
    expect(isCheckRunning(true, summary())).toBe(true);
    expect(isCheckRunning(false, summary({ check_running: true }))).toBe(true);
    expect(isCheckRunning(true, null)).toBe(true);
  });

  it("is not running when neither does", () => {
    expect(isCheckRunning(false, summary())).toBe(false);
    expect(isCheckRunning(false, undefined)).toBe(false);
  });

  it("the chip names no AI", () => {
    expect(CHECKING_ROWS_LABEL).toBe("Checking rows…");
  });
});

describe("finalizeBlockMessage", () => {
  const clear = { breakCount: 0, unaffirmedCount: 0, qtyGap: 0, checkRunning: false, summary: summary() };

  it("does not block a sheet with nothing open", () => {
    expect(finalizeBlockMessage(clear)).toBeNull();
    expect(finalizeBlockMessage({ ...clear, summary: null })).toBeNull();
    expect(finalizeBlockMessage({ ...clear, summary: summary({ flagged: 6, checked: 6 }) })).toBeNull();
  });

  it("blocks while a flag is open, with the approved sentence", () => {
    expect(finalizeBlockMessage({ ...clear, summary: summary({ to_check: 6, flagged: 6 }) }))
      .toBe("Check the 6 flagged rows before finalizing.");
    expect(finalizeBlockMessage({ ...clear, summary: summary({ to_check: 1, flagged: 1 }) }))
      .toBe("Check the 1 flagged row before finalizing.");
  });

  it("blocks while the check is running, with the server's own sentence", () => {
    expect(finalizeBlockMessage({ ...clear, checkRunning: true })).toBe(CHECK_RUNNING_MESSAGE);
    expect(CHECK_RUNNING_MESSAGE)
      .toBe("The automatic check is still running on this sheet. Try again when it finishes.");
  });

  it("keeps today's three messages word for word", () => {
    expect(finalizeBlockMessage({ ...clear, breakCount: 2 }))
      .toBe("Fix the must-fix structural issues listed above before finalizing.");
    expect(finalizeBlockMessage({ ...clear, unaffirmedCount: 3 }))
      .toBe("Confirm the 3 rows that didn't carry from the original before finalizing.");
    expect(finalizeBlockMessage({ ...clear, unaffirmedCount: 1 }))
      .toBe("Confirm the 1 row that didn't carry from the original before finalizing.");
    expect(finalizeBlockMessage({ ...clear, qtyGap: 2 }))
      .toBe("Enter a valid quantity (present and not negative) for all 2 selected line items before finalizing.");
    expect(finalizeBlockMessage({ ...clear, qtyGap: 1 }))
      .toBe("Enter a valid quantity (present and not negative) for all 1 selected line item before finalizing.");
  });

  it("reports in the server's order: must-fix, revision rows, quantities, running, flags", () => {
    const all = {
      breakCount: 1, unaffirmedCount: 1, qtyGap: 1, checkRunning: true,
      summary: summary({ to_check: 4, flagged: 4 }),
    };
    expect(finalizeBlockMessage(all)).toMatch(/^Fix the must-fix/);
    expect(finalizeBlockMessage({ ...all, breakCount: 0 })).toMatch(/^Confirm the 1 row/);
    expect(finalizeBlockMessage({ ...all, breakCount: 0, unaffirmedCount: 0 })).toMatch(/^Enter a valid quantity/);
    expect(finalizeBlockMessage({ ...all, breakCount: 0, unaffirmedCount: 0, qtyGap: 0 }))
      .toBe(CHECK_RUNNING_MESSAGE);
    expect(finalizeBlockMessage({ ...all, breakCount: 0, unaffirmedCount: 0, qtyGap: 0, checkRunning: false }))
      .toBe("Check the 4 flagged rows before finalizing.");
  });
});

describe("revertMessageLines", () => {
  it("says nothing new after a revert that involved no child", () => {
    expect(revertMessageLines({ rowExcel: 20, returned: [], notReturned: [] })).toBeNull();
  });

  it("names the children that came back", () => {
    expect(revertMessageLines({ rowExcel: 20, returned: [21, 23, 24], notReturned: [] }))
      .toEqual(["Row 20 reverted, along with 3 child rows it had moved: rows 21, 23, 24."]);
  });

  it("names each child that was not moved back, one line each, with the reason", () => {
    expect(revertMessageLines({ rowExcel: 20, returned: [21, 23], notReturned: [22, 24] })).toEqual([
      "Row 20 reverted, along with 2 child rows it had moved: rows 21, 23.",
      "Row 22 was not moved back because it was moved separately.",
      "Row 24 was not moved back because it was moved separately.",
    ]);
  });

  it("reads one returned child in the singular", () => {
    expect(revertMessageLines({ rowExcel: 20, returned: [21], notReturned: [] }))
      .toEqual(["Row 20 reverted, along with 1 child row it had moved: row 21."]);
  });

  it("when no child came back but one stayed, says the row reverted and why the child stayed", () => {
    expect(revertMessageLines({ rowExcel: 20, returned: [], notReturned: [22] })).toEqual([
      "Row 20 reverted.",
      "Row 22 was not moved back because it was moved separately.",
    ]);
  });
});

// ── S4b (ADR-0035) ───────────────────────────────────────────────────────────

describe("checkCounter while the check runs (U12)", () => {
  const open = summary({ flagged: 7, to_check: 7, by_kind: { type: 7, parent: 0, both: 0 } });

  it("draws no strip while the check is running", () => {
    expect(checkCounter(open, true)).toBeNull();
  });

  it("draws the strip, with the server's numbers, once the check has ended", () => {
    expect(checkCounter(open, false)?.title).toBe("7 rows to check");
    expect(checkCounter(open)?.title).toBe("7 rows to check");
  });

  it("hides the green all-checked strip too while a check runs", () => {
    expect(checkCounter(summary({ flagged: 3, checked: 3 }), true)).toBeNull();
  });
});

describe("heavyBannerText (U1)", () => {
  it("is the approved sentence with the server's percentage", () => {
    expect(heavyBannerText(summary({ heavy: true, flagged_pct: 63 }))).toBe(
      "Many rows on this sheet need checking (63%). We recommend reviewing the whole sheet before finalizing.",
    );
  });

  it("shows a percentage that is not whole with one decimal", () => {
    expect(heavyBannerText(summary({ heavy: true, flagged_pct: 40.4 }))).toContain("(40.4%)");
    expect(pctText(50)).toBe("50%");
    expect(pctText(15.8)).toBe("15.8%");
  });

  it("is nothing on a sheet the server does not call heavy -- it holds no 40% rule of its own", () => {
    expect(heavyBannerText(summary({ heavy: false, flagged_pct: 99 }))).toBeNull();
    expect(heavyBannerText(null)).toBeNull();
  });

  it("is nothing while the check runs: the percentage is not settled", () => {
    expect(heavyBannerText(summary({ heavy: true, flagged_pct: 63 }), true)).toBeNull();
  });
});

describe("isCheckIncomplete (U2)", () => {
  it("is true for a failed check with nothing running", () => {
    expect(isCheckIncomplete(summary({ check_status: "incomplete" }))).toBe(true);
  });

  it("is false for a finished, a running and a never-run check", () => {
    expect(isCheckIncomplete(summary({ check_status: "done" }))).toBe(false);
    expect(isCheckIncomplete(summary({ check_status: "running", check_running: true }))).toBe(false);
    expect(isCheckIncomplete(summary({ check_status: "not_run" }))).toBe(false);
    expect(isCheckIncomplete(null)).toBe(false);
  });

  it("is false while a new check is running over an older failure", () => {
    expect(isCheckIncomplete(summary({ check_status: "incomplete" }), true)).toBe(false);
  });

  it("carries the approved banner sentence and button", () => {
    expect(CHECK_INCOMPLETE_BANNER).toBe(
      "The automatic row check didn't finish on this sheet. Only rows with a unit or quantity that aren't Items were flagged. Re-parse the sheet to run the full check again.",
    );
    expect(REPARSE_SHEET_LABEL).toBe("Re-parse sheet");
  });
});

describe("suggestionFor (U10, R31)", () => {
  const answer = { ai_suggested_classification: "note", ai_suggested_parent: 14, ai_suggested_is_root: 0 };

  it("suggests the stored type while Check type is open for a type doubt", () => {
    expect(suggestionFor({ ...answer, check_flags: OPEN_TYPE })).toEqual({ type: "note", parent: null });
  });

  it("suggests Item for a row flagged ONLY for a unit or quantity (R31b)", () => {
    const row = {
      ...answer, ai_suggested_classification: null,
      check_flags: flags({ check_type: true, reasons: ["unit_qty_not_item"], doubts: ["unit_qty_not_item"] }),
    };
    expect(suggestionFor(row).type).toBe("line_item");
  });

  it("with both doubts and different answers, the stored type wins (Q-b)", () => {
    const row = {
      ...answer,
      check_flags: flags({
        check_type: true, reasons: ["type_doubt", "unit_qty_not_item"], doubts: ["type_doubt", "unit_qty_not_item"],
      }),
    };
    expect(suggestionFor(row).type).toBe("note");
  });

  it("suggests the stored parent while Check parent is open", () => {
    expect(suggestionFor({ ...answer, check_flags: OPEN_PARENT })).toEqual({ type: null, parent: 14 });
  });

  it("suggests top level as -1, and row 0 as a real row", () => {
    expect(suggestionFor({ ...answer, ai_suggested_is_root: 1, check_flags: OPEN_PARENT }).parent).toBe(-1);
    expect(suggestionFor({ ...answer, ai_suggested_parent: 0, check_flags: OPEN_PARENT }).parent).toBe(0);
  });

  it("suggests nothing on an unflagged row, whatever answer is stored", () => {
    expect(suggestionFor({ ...answer, check_flags: flags() })).toEqual({ type: null, parent: null });
    expect(suggestionFor({ ...answer, check_flags: null })).toEqual({ type: null, parent: null });
    expect(suggestionFor(null)).toEqual({ type: null, parent: null });
  });

  it("suggests nothing once the flag is answered or ticked", () => {
    expect(suggestionFor({ ...answer, check_flags: FIXED_TYPE })).toEqual({ type: null, parent: null });
    expect(suggestionFor({ ...answer, check_flags: TICKED })).toEqual({ type: null, parent: null });
    expect(suggestionFor({ ...answer, check_flags: FIXED_BOTH })).toEqual({ type: null, parent: null });
  });

  it("keeps only the half that is still open on a row that was Check both", () => {
    expect(suggestionFor({ ...answer, check_flags: BOTH_TYPE_FIXED })).toEqual({ type: null, parent: 14 });
  });

  it("suggests no parent when the stored answer names none (-1 without top level)", () => {
    expect(suggestionFor({ ...answer, ai_suggested_parent: -1, check_flags: OPEN_PARENT }).parent).toBeNull();
    expect(suggestionFor({ ...answer, ai_suggested_parent: null, check_flags: OPEN_PARENT }).parent).toBeNull();
  });

  it("names no AI: the mark is the one word", () => {
    expect(SUGGESTED_LABEL).toBe("Suggested");
  });
});

describe("orderWithSuggestion (U10)", () => {
  const TYPES = ["line_item", "preamble", "note", "spacer"] as const;

  it("puts the suggested option first and keeps every other option, in order", () => {
    expect(orderWithSuggestion<string>(TYPES, "note")).toEqual(["note", "line_item", "preamble", "spacer"]);
  });

  it("leaves the list exactly as it was with no suggestion", () => {
    expect(orderWithSuggestion<string>(TYPES, null)).toEqual([...TYPES]);
  });

  it("adds nothing for a suggestion the list does not offer", () => {
    expect(orderWithSuggestion<string>(TYPES, "subtotal_marker")).toEqual([...TYPES]);
  });

  it("never drops or repeats an option", () => {
    for (const t of TYPES) {
      expect([...orderWithSuggestion<string>(TYPES, t)].sort()).toEqual([...TYPES].sort());
    }
  });
});

describe("suggestedParentLine (Q-g)", () => {
  // 0 ── 1 ── 2 ── 3 ; 4 is another root
  const rows = [
    { row_index: 0, effective_parent_index: null, source_row_number: 6, description: "Section A" },
    { row_index: 1, effective_parent_index: 0, source_row_number: 7, description: "Pipes" },
    { row_index: 2, effective_parent_index: 1, source_row_number: 8, description: " 25 mm " },
    { row_index: 3, effective_parent_index: 2, source_row_number: 9, description: null },
    { row_index: 4, effective_parent_index: null, source_row_number: 10, description: "" },
  ];

  it("names the suggested row by its Excel row and description", () => {
    expect(suggestedParentLine(3, 0, rows)).toEqual({ target: 0, text: "Suggested parent: row 6 - Section A" });
    expect(suggestedParentLine(4, 2, rows)?.text).toBe("Suggested parent: row 8 - 25 mm");
  });

  it("says Top level for -1", () => {
    expect(suggestedParentLine(3, -1, rows)).toEqual({ target: -1, text: "Suggested: Top level" });
  });

  it("is nothing when nothing is suggested", () => {
    expect(suggestedParentLine(3, null, rows)).toBeNull();
    expect(suggestedParentLine(3, undefined, rows)).toBeNull();
  });

  it("is nothing when the suggested row is the row itself", () => {
    expect(suggestedParentLine(1, 1, rows)).toBeNull();
  });

  it("is nothing when the suggested row is a descendant of the row (a loop)", () => {
    expect(suggestedParentLine(1, 2, rows)).toBeNull();
    expect(suggestedParentLine(0, 3, rows)).toBeNull();
  });

  it("is nothing when the suggested row no longer exists", () => {
    expect(suggestedParentLine(1, 99, rows)).toBeNull();
  });

  it("writes a placeholder for a row with no description", () => {
    expect(suggestedParentLine(0, 4, rows)?.text).toBe("Suggested parent: row 10 - (no description)");
  });

  it("ends on a broken parent chain instead of looping", () => {
    const looped = [
      { row_index: 0, effective_parent_index: 1, source_row_number: 1, description: "a" },
      { row_index: 1, effective_parent_index: 0, source_row_number: 2, description: "b" },
      { row_index: 2, effective_parent_index: null, source_row_number: 3, description: "c" },
    ];
    expect(suggestedParentLine(2, 0, looped)?.target).toBe(0);
  });
});

describe("revert wording (U9, U14)", () => {
  it("is the approved button, line and fallback", () => {
    expect(REVERT_LABEL).toBe("Revert to original");
    expect(REVERT_HINT).toBe(
      "Restores this row (and any moved children) to how it was after parsing. Its check flag comes back.",
    );
    expect(REVERT_FAILED_MESSAGE).toBe("Could not revert this row. Please try again.");
  });
});

// The review tree is too large to mount here; these read its source for what S4b removed and
// what it must keep. They cover ReviewTree.tsx and RestructureModal.tsx only.
describe("review screen source (U9, U11, R31c)", () => {
  const tree = readFileSync(join(__dirname, "ReviewTree.tsx"), "utf8");
  const modal = readFileSync(join(__dirname, "RestructureModal.tsx"), "utf8");

  it("no longer draws the three Edit blocks, their toggle or their confirm dialog", () => {
    for (const gone of [">Edit values<", ">Edit text<", ">Edit per-area values<", "Confirm value change", "AccordionTrigger"]) {
      expect(tree).not.toContain(gone);
    }
    expect(tree).not.toMatch(/^\s*Edit Row\s*$/m);
  });

  it("still saves the template quantity cells through save_review_edit", () => {
    expect(tree).toContain("review_screen.save_review_edit");
    expect(tree).toContain("onSaveArea={saveAreaQtyInline}");
    expect(tree).toContain("onBlur={(e) => saveQtyInline(row, e.target.value)}");
  });

  it("keeps remarks and the history of old edits", () => {
    expect(tree).toContain("review_screen.save_review_remark");
    expect(tree).toContain('verb: "Edited"');
  });

  it("has no button that still says Revert to parser", () => {
    expect(tree).not.toContain('"Revert to parser"}');
    expect(tree).toContain("REVERT_LABEL");
    expect(tree).not.toContain("to the parser baseline");
  });

  it("makes the revert wait for the page's lock call", () => {
    expect(tree).toContain("afterEditIntent(onEditIntent, () => revertToParserCall(");
  });

  it("the restructure dialog still has its five options, nothing pre-selected, and the same save", () => {
    for (const option of [
      "Move all children up to this row's current parent",
      "Keep all children under this row",
      "Move all children to one new parent",
      "Decide each child individually",
      "Make all children top-level",
    ]) expect(modal).toContain(option);
    expect(modal).toContain("useState<PlacementOption | null>(null)");
    expect(modal).toContain("review_screen.save_review_restructure");
    expect(modal).toContain('if (rowPosition === "move" && rowParentIdx === null) return false;');
  });

  it("the dialog names no AI in the suggested line", () => {
    expect(modal).toContain("suggestedParentLine(row.row_index, suggestedParent, rows)");
  });

  it("the suggested line sits below the Keep / Move radios, so it never takes the opening focus", () => {
    const radios = modal.lastIndexOf('<span>Move this row under a new parent</span>');
    const line = modal.indexOf("{suggestedLine && (");
    const picker = modal.indexOf('{rowPosition === "move" && (');
    expect(radios).toBeGreaterThan(0);
    expect(line).toBeGreaterThan(radios);
    expect(picker).toBeGreaterThan(line);
  });
});
