/**
 * templateSelection.ts -- PURE helpers for the template-flow row selection (T10) +
 * row create/delete (T11) affordances on the review screen. Imports ONLY the ReviewRow
 * type (no React, no frappe) so the rules are unit-testable in isolation (ADR-0010 F4)
 * and mirror the backend `template_select.py` eligibility partition (F1 parity target).
 *
 * These are used ONLY on template-origin BoQs; on an upload BoQ every row is is_excluded=0
 * (the flag is inert), so the derived state is a no-op there.
 */
import type { ReviewRow } from "./boqTypes";

// The two classes whose selection is STORED as is_excluded (mirrors backend
// _ELIGIBLE_CLASSIFICATIONS). Everything else (note / spacer / subtotal_marker /
// header_repeat) rides along with its nearest eligible ancestor -- no checkbox.
export const SELECTABLE_CLASSIFICATIONS: ReadonlySet<string> = new Set([
  "preamble",
  "line_item",
]);

/** A row is directly selectable (gets a checkbox) iff its EFFECTIVE classification is
 *  preamble or line_item. Non-eligible rows ride along and are never written. */
export function isSelectableRow(row: ReviewRow): boolean {
  return (
    row.effective_classification != null &&
    SELECTABLE_CLASSIFICATIONS.has(row.effective_classification)
  );
}

/** Excluded (deselected) iff is_excluded === 1. Absent/0 => included (default). */
export function isRowExcluded(row: ReviewRow): boolean {
  return row.is_excluded === 1;
}

/**
 * Can this row carry a quantity AT ALL? The single eligibility rule for the template review
 * screen's quantity surface -- it gates cell editability AND (by consequence, since a
 * non-editable cell renders no input) which rows keyboard navigation stops on.
 *
 * TWO conditions, and both matter:
 *   - the CLASSIFICATION must be preamble / line_item (`isSelectableRow`) -- a note, spacer or
 *     subtotal marker is a ride-along row the clone never seeds `qty_by_area` for;
 *   - the row must be SELECTED -- a deselected row is not committed, so a quantity on it is
 *     dead data (and `set_row_excluded` now clears it on deselect anyway).
 *
 * Keeping both here means "editable" and "navigable" can never drift apart.
 */
export function isQtyEligibleRow(row: ReviewRow): boolean {
  return isSelectableRow(row) && !isRowExcluded(row);
}

/** WHY a line item's quantity is invalid, or null when it is fine. Two reasons, because the
 *  review block has to say which one -- "no quantity" on a row that visibly holds -5 is the
 *  message that sent reviewers hunting for a blank cell that was never there.
 *
 *  NEGATIVE is tested FIRST: it is the more actionable reading of a row that is both blank in
 *  total and negative in one area. The resulting TRUTH SET (null vs non-null) is identical to
 *  the pre-split rule, so the Finalize gate is unchanged. */
export type QtyGapReason = "missing" | "negative";

export function qtyGapReason(row: ReviewRow): QtyGapReason | null {
  const qt = row.qty_total;
  if (typeof qt === "number" && qt < 0) return "negative"; // negative total
  const qba = row.qty_by_area;
  if (qba) {
    for (const v of Object.values(qba)) {
      if (typeof v === "number" && v < 0) return "negative"; // any negative area
    }
  }
  if (!qt) return "missing"; // null / 0 / undefined -> all areas empty
  return null;
}

/** A line item's quantity is INVALID (a "gap") iff it is missing/zero (falsy qty_total ->
 *  all areas empty for multi-area, since qty_total = sum(areas)), a NEGATIVE total, or has
 *  ANY negative per-area value. Mirrors the backend `_template_line_item_qty_gap` finalize
 *  backstop -- the save path blocks negative entry; this is the belt-and-suspenders check
 *  the Finalize gate reads. FE<->BE parity target (ADR-0010 F1). */
export function isLineItemQtyGap(row: ReviewRow): boolean {
  return qtyGapReason(row) !== null;
}

/** One review-block entry per SELECTED line item whose quantity is a gap. `rowIndex` is what
 *  ReviewTree's revealAndScrollToRow takes (it expands collapsed ancestors before scrolling);
 *  `excelRow` is display only. Shaped like priceability's buildFlagEntries, minus the kind
 *  fan-out -- there is one flag here. */
export interface QtyGapEntry {
  rowIndex: number;
  excelRow: number | null;
  description: string;
  reason: QtyGapReason;
  text: string;
}

const QTY_GAP_TEXT: Record<QtyGapReason, string> = {
  missing: "Needs a quantity -- this line is blank or zero.",
  negative: "Needs a quantity -- a negative value was entered.",
};

export function buildQtyGapEntries(rows: ReviewRow[]): QtyGapEntry[] {
  const out: QtyGapEntry[] = [];
  for (const r of rows) {
    if (r.effective_classification !== "line_item" || isRowExcluded(r)) continue;
    const reason = qtyGapReason(r);
    if (!reason) continue;
    out.push({
      rowIndex: r.row_index,
      excelRow: r.source_row_number ?? null,
      description: (r.description ?? "").trim(),
      reason,
      text: QTY_GAP_TEXT[reason],
    });
  }
  return out;
}

/** Blocking count: SELECTED (included) line items whose quantity is a gap (missing OR
 *  negative -- see isLineItemQtyGap). Drives the Finalize disabled-gate + tooltip. Name kept
 *  for call-site stability; semantics widened from "no qty" to "invalid qty" (A2 negative rule).
 *  Derived from buildQtyGapEntries so the review block's count and the Finalize tooltip's
 *  count can never disagree -- one list, one length. */
export function countSelectedLineItemsNoQty(rows: ReviewRow[]): number {
  return buildQtyGapEntries(rows).length;
}

/** Short human label for a row in the create-dialog parent picker: "Row 42: Cabling…"
 *  (synthetic rows have no source_row_number -> "New row: …"). Description is trimmed +
 *  ellipsised so the Select option stays one line. */
export function rowPickerLabel(row: ReviewRow): string {
  const prefix =
    row.source_row_number !== null && row.source_row_number !== undefined
      ? `Row ${row.source_row_number}`
      : "New row";
  const desc = (row.description ?? "").trim();
  const short = desc.length > 40 ? `${desc.slice(0, 40)}…` : desc;
  return short ? `${prefix}: ${short}` : prefix;
}
