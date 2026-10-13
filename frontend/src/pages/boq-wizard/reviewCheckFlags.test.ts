import { describe, expect, it } from "vitest";
import type { CheckSummary, RowCheckFlags } from "./boqTypes";
import {
  CHECK_FILTERS,
  CHECK_FILTER_LABELS,
  CHECK_REASON_LINES,
  CHECK_RUNNING_MESSAGE,
  CHECKING_ROWS_LABEL,
  checkCounter,
  checkPill,
  checkReasonLines,
  finalizeBlockMessage,
  isCheckOpen,
  isCheckRunning,
  isRowFlagged,
  matchesCheckFilter,
  revertMessageLines,
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
