/**
 * reviewHistory -- the words of a review row's history line (S6, ADR-0036). Pure.
 *
 * ReviewTree's describeEditEntry (A2 edit-log clarity) asks here first, for:
 *  - F7 / U6 and owner ruling Q-h: a revert entry stores what was CLEARED (`to: null`), so the
 *    line used to read "Note → —" (type) or "→ root" (parent) whatever the row went back to.
 *    It now names the parsed value the row went back to: "Reverted: Note → Preamble",
 *    "Reverted parent: → row 8".
 *  - F13 / U11: stored reasons name rows by their INTERNAL index ("parent moved: row 5 ...").
 *    They stay stored as they are -- the revert cascade reads those numbers back
 *    (review_flags._CHILD_MOVE_RE / _CASCADE_REVERT_RE) -- and are shown with the Excel row.
 */
import { CLS_LABELS } from "./reviewRender";

export interface HistoryEntry {
  field: string;
  from?: unknown;
  to?: unknown;
  reason?: string | null;
}

export interface DescribedEditEntry {
  verb: string;
  detail: string | null;
  showField: boolean;
}

export interface HistoryContext {
  /** The row's parsed type (the review row's `classification`). */
  parsedClassification: string | null | undefined;
  /** A stored parent value (internal row_index, or null / -1 for top level) as a label. */
  parentLabel: (v: unknown) => string;
  /** The row's parsed parent (its `parent_index`). */
  parsedParent: unknown;
}

/** The backend's REVERT_REASON_WORD (review_flags.py): every revert reason starts with it. */
const REVERT_WORD = "reverted";

function isRevertEntry(entry: HistoryEntry): boolean {
  return (entry.to === null || entry.to === undefined) &&
    typeof entry.reason === "string" && entry.reason.startsWith(REVERT_WORD);
}

function clsLabel(v: unknown): string {
  return CLS_LABELS[String(v ?? "")] ?? String(v ?? "—");
}

/**
 * The words for a REVERT history entry, or null when the entry is not a revert (the caller then
 * describes it as before). Type: "Reverted: Note → Preamble"; parent: "Reverted parent: → row 8".
 */
export function describeRevertEntry(entry: HistoryEntry, ctx: HistoryContext): DescribedEditEntry | null {
  if (!isRevertEntry(entry)) return null;
  if (entry.field === "human_classification") {
    // A no-op entry (nothing to clear) keeps today's handling: suppressed by the caller (#162).
    if (entry.from === null || entry.from === undefined) return null;
    return { verb: "Reverted", detail: `${clsLabel(entry.from)} → ${clsLabel(ctx.parsedClassification)}`, showField: false };
  }
  if (entry.field === "human_parent") {
    return { verb: "Reverted parent", detail: `→ ${ctx.parentLabel(ctx.parsedParent)}`, showField: false };
  }
  return null;
}

/**
 * A stored reason with every "row N" (internal index) shown as the Excel row. An index not on the
 * sheet keeps its number. Display only: the stored reason is never rewritten.
 */
export function reasonWithExcelRows(
  reason: string,
  excelOf: (rowIndex: number) => number | null | undefined,
): string {
  return reason.replace(/\brow (\d+)\b/g, (whole, n: string) => {
    const ex = excelOf(Number(n));
    return ex === null || ex === undefined ? whole : `row ${ex}`;
  });
}
