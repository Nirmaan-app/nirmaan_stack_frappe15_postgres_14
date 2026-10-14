/**
 * hubCheckSummary -- what the BoQ hub says about the automatic row check (S4b, ADR-0035): the
 * lines on a sheet card, the footer's count, and the "Parse complete" summary.
 *
 * Every number is the server's, from `review_flags.get_check_summary` -- the same function the
 * review screen's counter and the finalize block read. Nothing is counted or decided here, so the
 * hub, the review screen and the refusal cannot disagree (ADR-0010 F1 / F4).
 *
 * Pure: no React, no fetch.
 */
import type { CheckSummary } from "./boqTypes";
import { CHECKING_ROWS_LABEL, pctText } from "./reviewCheckFlags";

function rowsToCheck(count: number): string {
  return `${count} ${count === 1 ? "row" : "rows"} to check`;
}

/** Display form of a sheet name; the VERBATIM name stays the key everywhere (#152). */
function displayName(sheetName: string): string {
  return sheetName.trim() || sheetName;
}

// ── The sheet card ───────────────────────────────────────────────────────────

export const CARD_CHECK_IN_PROGRESS = "check in progress";
export const CARD_ALL_CHECKED = "all flagged rows checked";
export const CARD_CHECK_INCOMPLETE = "check incomplete";
export const CARD_CHECK_INCOMPLETE_NOTE =
  "The automatic row check didn't finish on this sheet. Only the quantity / unit check ran. Re-parse to try again.";

export interface CardCheckLine {
  text: string;
  /** attention = rows left / incomplete; ok = everything flagged is checked. */
  tone: "attention" | "ok";
}

export interface CardCheck {
  /** The top-right chip while the check runs ("Checking rows…"), else null. */
  chip: string | null;
  /** Replaces the Review step's date while the check runs: "Parsed · check in progress". */
  stageSub: string | null;
  /** The short lines under the Review step. */
  lines: CardCheckLine[];
  /** The longer sentence under them, or null. */
  note: string | null;
}

const NOTHING: CardCheck = { chip: null, stageSub: null, lines: [], note: null };

/**
 * What one sheet card shows about the check. `effectiveStatus` is the card's own status; only a
 * Parsed or Finalized sheet has anything to say. A sheet parsed before the check existed
 * (`not_run`) and a sheet with no flagged row show nothing here -- the card is exactly as before;
 * S6's "not checked" line comes from `cardNotChecked`, which needs the commit state too.
 */
export function cardCheck(
  effectiveStatus: string,
  summary: CheckSummary | null | undefined,
): CardCheck {
  if (!summary) return NOTHING;
  if (effectiveStatus !== "Parsed" && effectiveStatus !== "Finalized") return NOTHING;
  if (summary.check_running) {
    return { chip: CHECKING_ROWS_LABEL, stageSub: CARD_CHECK_IN_PROGRESS, lines: [], note: null };
  }
  const lines: CardCheckLine[] = [];
  let note: string | null = null;
  if (summary.check_status === "incomplete") {
    lines.push({ text: CARD_CHECK_INCOMPLETE, tone: "attention" });
    if (effectiveStatus === "Parsed") note = CARD_CHECK_INCOMPLETE_NOTE;
  }
  if (summary.to_check > 0) {
    lines.push({ text: rowsToCheck(summary.to_check), tone: "attention" });
  } else if (summary.flagged > 0) {
    lines.push({ text: CARD_ALL_CHECKED, tone: "ok" });
  }
  return { chip: null, stageSub: null, lines, note };
}

// S6 (U1, owner rulings V1 / Q-i): a sheet whose automatic check never ran must not look like a
// clean, checked sheet -- but only while that matters: the sheet was never committed, or was
// re-parsed after its last commit. A committed sheet unchanged since shows nothing.
export const CARD_NOT_CHECKED = "not checked";

/** The extra card line for a not-checked sheet, or null. `changedSinceCommit` from hubState. */
export function cardNotChecked(
  effectiveStatus: string,
  summary: CheckSummary | null | undefined,
  changedSinceCommit: boolean,
): CardCheckLine | null {
  if (!summary || summary.check_running || summary.check_status !== "not_run") return null;
  if (effectiveStatus !== "Parsed" && effectiveStatus !== "Finalized") return null;
  return changedSinceCommit ? { text: CARD_NOT_CHECKED, tone: "attention" } : null;
}

/** Is the check of any sheet of this BoQ running? Drives the hub's poll. */
export function anyCheckRunning(sheets: Record<string, CheckSummary> | null | undefined): boolean {
  return !!sheets && Object.values(sheets).some((s) => s.check_running);
}

// ── The footer ───────────────────────────────────────────────────────────────

/**
 * The footer's added piece: " · N rows to check", N = the sum over PARSED sheets whose check is
 * not running, or "" at zero.
 * `parsedSheetNames` are VERBATIM names (#152).
 */
export function footerRowsToCheck(
  parsedSheetNames: readonly string[],
  sheets: Record<string, CheckSummary> | null | undefined,
): string {
  if (!sheets) return "";
  let total = 0;
  for (const name of parsedSheetNames) {
    const summary = sheets[name];
    // A sheet still being checked is left out: until the check ends its count is the raw parse's
    // unit / quantity flags, some of which the check removes (the review screen hides it too, U12).
    if (summary && !summary.check_running) total += summary.to_check;
  }
  return total > 0 ? ` · ${rowsToCheck(total)}` : "";
}

/**
 * The footer's " · N not checked" (U1), N = sheets among `sheetNames` (Parsed or Finalized,
 * VERBATIM) whose check never ran and that changed since their last commit; "" at zero.
 */
export function footerNotChecked(
  sheetNames: readonly string[],
  sheets: Record<string, CheckSummary> | null | undefined,
  changed: ReadonlySet<string>,
): string {
  if (!sheets) return "";
  const n = sheetNames.filter(
    (name) => sheets[name]?.check_status === "not_run" && !sheets[name]?.check_running && changed.has(name),
  ).length;
  return n > 0 ? ` · ${n} not checked` : "";
}

// ── The "Parse complete" summary ─────────────────────────────────────────────

export const SUMMARY_TO_CHECK_TITLE = "Rows to check before finalizing";

export interface ParseSummary {
  /** "Parsed and checked: A, B" -- the sheets whose check finished. */
  checkedLine: string | null;
  /** "Parsed: C" -- parsed sheets with no finished or failed check on record (the old wording). */
  parsedLine: string | null;
  /** "Parsed, not checked: D" -- parsed sheets whose check never ran (S6 U1). A sheet this parse
   *  just parsed has changed since any commit, so Q-i's rule always holds here. */
  notCheckedLine: string | null;
  /** One line per sheet that has rows to check: "A 6 of 38 rows (15.8%)". */
  toCheckLines: string[];
  /** One line per sheet whose check did not finish. */
  incompleteLines: string[];
}

/**
 * The check's part of the "Parse complete" summary, for the sheets THIS parse parsed.
 * N = rows to check, M = non-blank rows, P = the server's percentage (owner ruling Q-c).
 */
export function parseSummary(
  parsedSheetNames: readonly string[],
  sheets: Record<string, CheckSummary> | null | undefined,
): ParseSummary {
  const checked: string[] = [];
  const plain: string[] = [];
  const notChecked: string[] = [];
  const toCheckLines: string[] = [];
  const incompleteLines: string[] = [];
  for (const name of parsedSheetNames) {
    const summary = sheets?.[name];
    const label = displayName(name);
    if (summary?.check_status === "done") checked.push(label);
    else if (summary?.check_status === "not_run" && !summary.check_running) notChecked.push(label);
    else if (summary?.check_status === "incomplete") {
      incompleteLines.push(
        `Check didn't finish: ${label} - only the quantity / unit check ran. Re-parse the sheet to try again.`,
      );
    } else plain.push(label);
    if (summary && summary.to_check > 0) {
      toCheckLines.push(
        `${label} ${summary.to_check} of ${summary.non_blank_rows} rows (${pctText(summary.flagged_pct)})` +
          (summary.heavy ? " - review the whole sheet" : ""),
      );
    }
  }
  return {
    checkedLine: checked.length > 0 ? `Parsed and checked: ${checked.join(", ")}` : null,
    parsedLine: plain.length > 0 ? `Parsed: ${plain.join(", ")}` : null,
    notCheckedLine: notChecked.length > 0 ? `Parsed, not checked: ${notChecked.join(", ")}` : null,
    toCheckLines,
    incompleteLines,
  };
}

/**
 * May the summary open? Only once no sheet this parse parsed is still being checked (owner ruling
 * Q-c). With nothing parsed it opens at once. `sheets` undefined means "the counts have not been
 * read since the parse ended" and holds the summary back.
 */
export function summaryReady(
  parsedSheetNames: readonly string[],
  sheets: Record<string, CheckSummary> | null | undefined,
): boolean {
  if (parsedSheetNames.length === 0) return true;
  if (!sheets) return false;
  return !parsedSheetNames.some((name) => sheets[name]?.check_running);
}
