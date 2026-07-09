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

/** Advisory count: SELECTED (included) line items that carry no quantity. Non-blocking --
 *  surfaced as a soft "N selected line items have no quantity" note. "No quantity" = a
 *  falsy qty_total (null / 0 / undefined). */
export function countSelectedLineItemsNoQty(rows: ReviewRow[]): number {
  return rows.filter(
    (r) =>
      r.effective_classification === "line_item" &&
      !isRowExcluded(r) &&
      !r.qty_total,
  ).length;
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
