/**
 * reviewCheckFlags -- the review screen's reading of the server's review flags (S4a, ADR-0034).
 *
 * The RULES live on the server (`api/boq/wizard/review_flags.py`): which row is flagged, what
 * clears a flag, the counts, the finalize block. This module only turns the server's answer --
 * `check_flags` per row, `check_summary` per sheet -- into what the screen draws and says. It
 * holds no flag rule of its own, so a pill, a filter result, the counter and the Finalize button
 * can never disagree with the server's refusal (ADR-0010 F1 / F4).
 *
 * Every user-visible sentence of the feature is here. The server ships reason CODES; an unknown
 * code produces no line -- a code is never shown.
 *
 * Pure: no React, no fetch.
 */
import type { CheckKindCounts, CheckSummary, ReviewRow, RowCheckFlags } from "./boqTypes";

// ── The row pill ─────────────────────────────────────────────────────────────

export type CheckPillLabel = "Check type" | "Check parent" | "Check both" | "Checked";

/** How the pill is drawn: an open flag, a flag the user's own change answered, or a "Looks OK". */
export type CheckPillState = "open" | "struck" | "checked";

export interface CheckPill {
  label: CheckPillLabel;
  state: CheckPillState;
}

const REASON_PARENT_DOUBT = "parent_doubt";
const REASON_TYPE_DOUBT = "type_doubt";
const REASON_UNIT_QTY = "unit_qty_not_item";

/** True while any flag of the row is open. */
export function isCheckOpen(flags: RowCheckFlags | null | undefined): boolean {
  return !!flags && (flags.check_type || flags.check_parent);
}

/** True when the row was flagged at all, open or already dealt with. */
export function isRowFlagged(flags: RowCheckFlags | null | undefined): boolean {
  return !!flags && flags.doubts.length > 0;
}

function kindLabel(type: boolean, parent: boolean): CheckPillLabel {
  if (type && parent) return "Check both";
  return type ? "Check type" : "Check parent";
}

/**
 * The pill of one row, or null for a row that was never flagged.
 *
 * - a flag is open -> the kind still OPEN ("Check both" becomes the one that remains when the
 *   other is answered);
 * - nothing open and the row is ticked -> "Checked";
 * - nothing open and not ticked (the user's change answered it) -> the kind that WAS flagged,
 *   struck through.
 */
export function checkPill(flags: RowCheckFlags | null | undefined): CheckPill | null {
  if (!flags || !isRowFlagged(flags)) return null;
  if (isCheckOpen(flags)) {
    return { label: kindLabel(flags.check_type, flags.check_parent), state: "open" };
  }
  if (flags.looks_ok) return { label: "Checked", state: "checked" };
  const parentDoubted = flags.doubts.includes(REASON_PARENT_DOUBT);
  const typeDoubted = flags.doubts.some((code) => code !== REASON_PARENT_DOUBT);
  return { label: kindLabel(typeDoubted, parentDoubted), state: "struck" };
}

// ── Reason lines ─────────────────────────────────────────────────────────────

/** The server's reason codes -> the one neutral line each shows (no AI name, no suggestion). */
export const CHECK_REASON_LINES: Readonly<Record<string, string>> = {
  type_doubt: "Row type may be wrong",
  unit_qty_not_item: "Has a unit or quantity but isn't an Item",
  parent_doubt: "Parent may be wrong",
};

/** One line per OPEN reason, in the server's order. An unknown code gives no line. */
export function checkReasonLines(flags: RowCheckFlags | null | undefined): string[] {
  if (!flags) return [];
  const lines: string[] = [];
  for (const code of flags.reasons) {
    const line = CHECK_REASON_LINES[code];
    if (line && !lines.includes(line)) lines.push(line);
  }
  return lines;
}

export const NEEDS_CHECKING_TITLE = "Needs checking";
export const NEEDS_CHECKING_HINT =
  "Fix it with Change / Change parent below, or confirm it is right as it is.";
export const LOOKS_OK_LABEL = "Looks OK";
export const GRID_OK_LABEL = "OK";
export const UNDO_LABEL = "Undo";

// ── The Check filter ─────────────────────────────────────────────────────────

export type CheckFilter = "all" | "to_check" | "type" | "parent" | "checked";

export const CHECK_FILTERS: readonly CheckFilter[] = ["all", "to_check", "type", "parent", "checked"];

export const CHECK_FILTER_LABELS: Readonly<Record<CheckFilter, string>> = {
  all: "Show all rows",
  to_check: "To check",
  type: "Check type",
  parent: "Check parent",
  checked: "Checked",
};

/**
 * Does the row belong under this filter option? A "Check both" row needs its type AND its parent
 * looked at, so it appears under "Check type" and under "Check parent" (owner ruling Q-d).
 */
export function matchesCheckFilter(
  flags: RowCheckFlags | null | undefined,
  filter: CheckFilter,
): boolean {
  if (filter === "all") return true;
  if (!flags) return false;
  switch (filter) {
    case "to_check": return isCheckOpen(flags);
    case "type": return flags.check_type;
    case "parent": return flags.check_parent;
    case "checked": return flags.checked;
  }
}

// ── The counter strip ────────────────────────────────────────────────────────

export interface CheckCounter {
  /** "open" while rows are left to check; "done" (green) once every flagged row is checked. */
  state: "open" | "done";
  title: string;
  detail: string;
  /** The instruction line; only while rows are left. */
  hint: string | null;
  buttonLabel: string;
  /** The filter the button switches to. */
  buttonFilter: CheckFilter;
}

function rowsWord(count: number): string {
  return count === 1 ? "row" : "rows";
}

function kindsLine(kinds: CheckKindCounts): string {
  return `Row type ${kinds.type} · Parent ${kinds.parent} · Both ${kinds.both}`;
}

/**
 * The strip above the grid, or null on a sheet with no flagged row and while the check is still
 * running. Every number is the server's.
 * While rows are left the kinds are the OPEN ones; once all are checked the kinds are those of
 * every flagged row (`flagged_by_kind`), since the open ones are then all zero.
 */
export function checkCounter(
  summary: CheckSummary | null | undefined,
  checkRunning = false,
): CheckCounter | null {
  // S4b (U12): no strip while the check runs. Until it ends the server can only report the
  // unit / quantity flags of the raw parse, some of which the check then removes -- a number that
  // is about to change. "Checking rows…" shows instead.
  if (checkRunning) return null;
  if (!summary || summary.flagged <= 0) return null;
  if (summary.to_check > 0) {
    return {
      state: "open",
      title: `${summary.to_check} ${rowsWord(summary.to_check)} to check`,
      detail: `${kindsLine(summary.by_kind)} · ${summary.checked} checked`,
      hint: "Fix the row type or parent, or tick Looks OK. Each row must be checked before finalizing.",
      buttonLabel: "Filter to these rows",
      buttonFilter: "to_check",
    };
  }
  return {
    state: "done",
    title: `All ${summary.flagged} flagged ${rowsWord(summary.flagged)} checked`,
    detail: kindsLine(summary.flagged_by_kind ?? summary.by_kind),
    hint: null,
    buttonLabel: "Show checked rows",
    buttonFilter: "checked",
  };
}

// ── The running chip ─────────────────────────────────────────────────────────

export const CHECKING_ROWS_LABEL = "Checking rows…";

/**
 * Is the automatic check of this sheet running? Either source says so: the sheet's own flag
 * (set the moment the job is queued) or the run log behind `check_summary` (what the finalize
 * block reads) -- so the chip and the refusal cannot disagree.
 */
export function isCheckRunning(
  aiInProgress: boolean,
  summary: CheckSummary | null | undefined,
): boolean {
  return aiInProgress || !!summary?.check_running;
}

// ── Mark Finalized ───────────────────────────────────────────────────────────

/** The server's own sentence while the check runs (review_flags.CHECK_RUNNING_MESSAGE). */
export const CHECK_RUNNING_MESSAGE =
  "The automatic check is still running on this sheet. Try again when it finishes.";

export interface FinalizeBlockInput {
  /** Must-fix structural issues on the sheet. */
  breakCount: number;
  /** Revision rows that did not carry and are not yet confirmed. */
  unaffirmedCount: number;
  /** Template BoQ: selected line items with no valid quantity. */
  qtyGap: number;
  checkRunning: boolean;
  summary: CheckSummary | null | undefined;
}

/**
 * Why Mark Finalized is greyed out, or null when it is not. The order is the server's
 * (review_screen.mark_sheet_parsed_check_done): must-fix, revision rows, quantities, the check
 * still running, flagged rows. The server refuses in the same order and stays the last guard.
 */
export function finalizeBlockMessage(input: FinalizeBlockInput): string | null {
  const { breakCount, unaffirmedCount, qtyGap, checkRunning, summary } = input;
  if (breakCount > 0) {
    return "Fix the must-fix structural issues listed above before finalizing.";
  }
  if (unaffirmedCount > 0) {
    return `Confirm the ${unaffirmedCount} ${rowsWord(unaffirmedCount)} that didn't carry from the original before finalizing.`;
  }
  if (qtyGap > 0) {
    return `Enter a valid quantity (present and not negative) for all ${qtyGap} selected line item${qtyGap === 1 ? "" : "s"} before finalizing.`;
  }
  if (checkRunning) return CHECK_RUNNING_MESSAGE;
  const toCheck = summary?.to_check ?? 0;
  if (toCheck > 0) {
    // S6 (F3 / U2): name the open rows -- Excel rows, the server's own `open_rows` -- as the
    // server's refusal does (review_flags.finalize_refusal: up to 20, then "and N more").
    const rows = openRowsText(summary?.open_rows ?? []);
    return `Check the ${toCheck} flagged ${rowsWord(toCheck)} before finalizing${rows ? `: ${rows}` : ""}.`;
  }
  return null;
}

/** The server's refusal list limit (review_flags.REFUSAL_ROW_LIMIT). */
export const OPEN_ROWS_LIMIT = 20;

/** "row 26" / "rows 26, 44" / "rows 1, 2, ... 20 and 3 more"; "" for none. */
export function openRowsText(openRows: readonly number[]): string {
  if (openRows.length === 0) return "";
  if (openRows.length === 1) return `row ${openRows[0]}`;
  const shown = openRows.slice(0, OPEN_ROWS_LIMIT).join(", ");
  const more = openRows.length - OPEN_ROWS_LIMIT;
  return more > 0 ? `rows ${shown} and ${more} more` : `rows ${shown}`;
}

// ── The revert message ───────────────────────────────────────────────────────

export interface RevertMessageInput {
  /** Excel row of the reverted row. */
  rowExcel: number | string;
  /** Excel rows of the children that came back with it. */
  returned: Array<number | string>;
  /** Excel rows of the children its change had moved that stayed where they are. */
  notReturned: Array<number | string>;
}

/**
 * What the screen says after a revert that involved children -- one string per line -- or null
 * for a revert that involved none (nothing new is said then).
 */
export function revertMessageLines(input: RevertMessageInput): string[] | null {
  const { rowExcel, returned, notReturned } = input;
  if (returned.length === 0 && notReturned.length === 0) return null;
  const lines: string[] = [];
  if (returned.length === 0) {
    lines.push(`Row ${rowExcel} reverted.`);
  } else if (returned.length === 1) {
    lines.push(`Row ${rowExcel} reverted, along with 1 child row it had moved: row ${returned[0]}.`);
  } else {
    lines.push(
      `Row ${rowExcel} reverted, along with ${returned.length} child rows it had moved: rows ${returned.join(", ")}.`,
    );
  }
  for (const child of notReturned) {
    lines.push(`Row ${child} was not moved back because it was moved separately.`);
  }
  return lines;
}

// ── The sheet banners (S4b) ──────────────────────────────────────────────────

/** A percentage as the screen writes it: "63%", or one decimal when it is not whole ("40.4%"). */
export function pctText(pct: number): string {
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`;
}

/**
 * U1: the advice shown on a sheet where more than 40% of the non-blank rows are flagged, or null.
 * `heavy` and `flagged_pct` are the server's (review_flags.summarize); nothing is counted here.
 * Advice only -- it blocks nothing. Not shown while the check runs: the percentage is not settled.
 */
export function heavyBannerText(
  summary: CheckSummary | null | undefined,
  checkRunning = false,
): string | null {
  if (checkRunning || !summary?.heavy) return null;
  return `Many rows on this sheet need checking (${pctText(summary.flagged_pct)}). We recommend reviewing the whole sheet before finalizing.`;
}

/** U2: the automatic check of this sheet's current parse failed and nothing is running. */
export function isCheckIncomplete(
  summary: CheckSummary | null | undefined,
  checkRunning = false,
): boolean {
  return !checkRunning && summary?.check_status === "incomplete";
}

/**
 * S6 (U1, owner rulings V1 / Q-i): the automatic check never ran on this sheet's current parse,
 * and the sheet changed since its last commit (never committed, or re-parsed after it). A sheet
 * committed and unchanged since says nothing. `changedSinceCommit` from hubState.
 */
export function isCheckNotRun(
  summary: CheckSummary | null | undefined,
  checkRunning: boolean,
  changedSinceCommit: boolean,
): boolean {
  return !checkRunning && summary?.check_status === "not_run" && changedSinceCommit;
}

export const CHECK_NOT_RUN_BANNER =
  "This sheet's rows were not checked automatically. Look over every row yourself before finalizing.";

export const CHECK_INCOMPLETE_BANNER =
  "The automatic row check didn't finish on this sheet. Only rows with a unit or quantity that aren't Items were flagged. Re-parse the sheet to run the full check again.";
export const REPARSE_SHEET_LABEL = "Re-parse sheet";

// ── The "Suggested" mark (S4b, owner ruling R31) ─────────────────────────────

export const SUGGESTED_LABEL = "Suggested";
export const SUGGESTED_TOP_LEVEL_LINE = "Suggested: Top level";

export interface RowSuggestion {
  /** The type to mark in the Change list, or null. */
  type: string | null;
  /** The parent to offer: a row_index, -1 for top level, or null for none. */
  parent: number | null;
}

type SuggestionRow = Pick<
  ReviewRow,
  "check_flags" | "ai_suggested_classification" | "ai_suggested_parent" | "ai_suggested_is_root"
>;

/**
 * What to mark "Suggested" on a row -- and ONLY while the server says that flag is open.
 *
 * - Check type open for "Row type may be wrong": the stored answer's type. When the row is also
 *   flagged for a unit / quantity, the stored answer still wins (owner ruling Q-b).
 * - Check type open ONLY for "Has a unit or quantity but isn't an Item": Item (R31b).
 * - Check parent open: the stored answer's parent, or top level.
 *
 * Nothing on an unflagged row, and nothing once the flag is answered or ticked: `check_type` /
 * `check_parent` are then false. Whether a flag is open is never decided here.
 */
export function suggestionFor(row: SuggestionRow | null | undefined): RowSuggestion {
  const flags = row?.check_flags;
  const out: RowSuggestion = { type: null, parent: null };
  if (!row || !flags) return out;
  if (flags.check_type) {
    if (flags.reasons.includes(REASON_TYPE_DOUBT) && row.ai_suggested_classification) {
      out.type = row.ai_suggested_classification;
    } else if (flags.reasons.includes(REASON_UNIT_QTY)) {
      out.type = "line_item";
    }
  }
  if (flags.check_parent) {
    if (row.ai_suggested_is_root) out.parent = -1;
    else if (typeof row.ai_suggested_parent === "number" && row.ai_suggested_parent >= 0) {
      out.parent = row.ai_suggested_parent;
    }
  }
  return out;
}

/**
 * The Change list's order: the suggested option first, every other option after it in its usual
 * order. A suggestion that is not one of the options changes nothing -- no option is added,
 * removed or pre-selected.
 */
export function orderWithSuggestion<T>(options: readonly T[], suggested: T | null | undefined): T[] {
  if (suggested === null || suggested === undefined || !options.includes(suggested)) {
    return [...options];
  }
  return [suggested, ...options.filter((option) => option !== suggested)];
}

type ParentLineRow = Pick<
  ReviewRow,
  "row_index" | "effective_parent_index" | "source_row_number" | "description"
>;

export interface SuggestedParentLine {
  /** The parent the line offers: a row_index, or -1 for top level. */
  target: number;
  text: string;
}

/**
 * The "Suggested parent" line of the restructure dialog (owner ruling Q-g), or null.
 *
 * No line when nothing is suggested, when the suggested row is missing, and when it is the row
 * itself or one of its descendants -- the dialog would refuse that parent (a loop).
 */
export function suggestedParentLine(
  rowIndex: number,
  suggestedParent: number | null | undefined,
  rows: readonly ParentLineRow[],
): SuggestedParentLine | null {
  if (suggestedParent === null || suggestedParent === undefined) return null;
  if (suggestedParent < 0) return { target: -1, text: SUGGESTED_TOP_LEVEL_LINE };
  if (suggestedParent === rowIndex) return null;
  const byIndex = new Map(rows.map((r) => [r.row_index, r]));
  const target = byIndex.get(suggestedParent);
  if (!target) return null;
  // Walk up from the suggested row; meeting the row itself means it is a descendant.
  const seen = new Set<number>();
  let cursor: number | null | undefined = target.effective_parent_index;
  while (cursor !== null && cursor !== undefined && cursor >= 0 && !seen.has(cursor)) {
    if (cursor === rowIndex) return null;
    seen.add(cursor);
    cursor = byIndex.get(cursor)?.effective_parent_index;
  }
  const description = (target.description ?? "").trim() || "(no description)";
  return {
    target: suggestedParent,
    text: `Suggested parent: row ${target.source_row_number} - ${description}`,
  };
}

// ── Revert (S4b: U9, U14) ────────────────────────────────────────────────────

export const REVERT_LABEL = "Revert to original";
export const REVERT_HINT =
  "Restores this row (and any moved children) to how it was after parsing. Its check flag comes back.";
export const REVERT_FAILED_MESSAGE = "Could not revert this row. Please try again.";

// ── Review search: Enter (S6 F8 / U7) ────────────────────────────────────────

/**
 * What Enter in the review search box does: the first Enter after the matches change scrolls to
 * the current match (the arrows' `revealAndScrollToRow`); each further Enter steps to the next;
 * Shift+Enter steps back. null = nothing to do (no match).
 */
export function searchEnterAction(
  hitCount: number,
  currentShown: boolean,
  shift: boolean,
): "reveal" | "next" | "prev" | null {
  if (hitCount === 0) return null;
  if (shift) return "prev";
  return currentShown ? "next" : "reveal";
}
