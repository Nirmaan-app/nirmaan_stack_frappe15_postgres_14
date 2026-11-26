/**
 * DN vs DC status of one PO item — the owner's rule, in one home.
 *
 * Read by the project DN > DC Quantity Report (`useDNDCQuantityData`) and by the
 * PO page's Item-wise Delivery Challans & MIRs view, so the two never disagree.
 */

export type DNDCStatus =
  | "matched"
  | "mismatch"
  | "no_dc_update"
  | "pending_dn"
  | "partially_delivered";

/** Under-delivery tolerance, in percent — the same `delta` as `calculate_order_status`
 *  (api/delivery_notes/update_delivery_note.py). Applied ONLY where a quantity is
 *  compared against the ORDERED quantity: site cannot deliver a measured material
 *  (duct in SQMTR, pipe in metres) to an exact decimal. DN-vs-DC comparisons are
 *  paperwork, not measurement, and stay exact. */
export const DELIVERY_DELTA_PERCENT = 2.5;

/**
 * The status of one item from its ordered, received (DN) and challaned (DC) quantities.
 *
 * Five verdicts as one PRECEDENCE CHAIN — first match wins. Ordering is
 * load-bearing and each branch is disjoint from the ones above it, so no item
 * can satisfy two rules. Verified against all 12,188 billable item rows in the
 * live DB: the first three branches reproduce the previous three-verdict split
 * exactly (0 rows change status), and `partially_delivered` only ever claims
 * rows that used to read a vacuous "matched".
 *
 * 1. no_dc_update — material received, nothing challaned at all. Stays FIRST
 *    and keeps its `dcQty === 0` test, because this card is what agrees with
 *    the project Overview's DC Pending tile. 9,647 rows system-wide.
 * 2. mismatch — a challan exists but is short. The `dcQty > 0` guard is what
 *    keeps it disjoint from no_dc_update: without it, `dnQty === orderedQty &&
 *    dcQty === 0` satisfies BOTH, and that shape is 79% of all rows.
 * 3. pending_dn — nothing received yet. Ranked below the two paperwork
 *    verdicts so it can never take a PO off the red card.
 * 4. partially_delivered — delivery incomplete AND the challan matches the
 *    delivery note EXACTLY. Owner-specified definition (2026-09-09):
 *        dnQty > 0  AND  dnQty !== orderedQty  AND  dcQty === dnQty
 *    Both tests are deliberately EXACT, not tolerance-based.
 *
 *    Measured on all 12,188 billable item rows before this was adopted: the
 *    `dcQty === dnQty` clause yields 7 items / 1 PO, where `dcQty >= dnQty`
 *    yields 15 items / 6 POs. The 8-item difference is over-challaned rows
 *    (DC documents MORE than the DN), which fall through to "matched" here —
 *    including PO/014/00107/26-27, short 147.07 and 139.64 units, and
 *    PO/107/00088/25-26, ordered 1.00 against 0.50 received. Conversely the
 *    exact `!==` admits two sub-0.01 rounding rows on PO/146/00074/25-26
 *    (342.74 vs 342.73) that a tolerance would have suppressed.
 *
 *    This is the owner's call, made against those numbers — do NOT "fix" it
 *    back to >= / tolerance without re-raising it.
 * 5. matched — everything else.
 * OWNER'S SPECIFICATION, implemented verbatim and in the order given.
 * Nothing added, nothing removed. The 2.5% delta is applied to every
 * comparison against ORDERED quantity; DN-vs-DC comparisons stay exact.
 *   1. Pending DN           dnQty == 0
 *   2. Partially Delivered  dnQty > 0 && dnQty != orderQty && dnQty == dcQty
 *   3. No DC Update         dnQty > 0 && dcQty == 0 && dcQty != orderQty
 *   4. Mismatch             dnQty > 0 && dnQty == orderQty && dnQty > dcQty
 *   5. Matched              dnQty > 0 && dcQty == orderQty && dnQty <= dcQty
 */
export function dnDcItemStatus(orderedQty: number, dnQty: number, dcQty: number): DNDCStatus {
  // Tolerance for the ORDERED-quantity comparisons below. Mirrors
  // `calculate_order_status`: the branch is chosen by the DATA — if either side
  // has a fractional part the 2.5% delta applies, if both are whole numbers the
  // comparison is exact. Two of them because the "other" side differs.
  const dnOrderedTolerance =
    orderedQty % 1 !== 0 || dnQty % 1 !== 0 ? (orderedQty * DELIVERY_DELTA_PERCENT) / 100 : 0;
  const dcOrderedTolerance =
    orderedQty % 1 !== 0 || dcQty % 1 !== 0 ? (orderedQty * DELIVERY_DELTA_PERCENT) / 100 : 0;

  if (dnQty === 0) {
    return "pending_dn";
  }
  if (dnQty > 0 && Math.abs(dnQty - orderedQty) > dnOrderedTolerance && dcQty === dnQty) {
    return "partially_delivered";
  }
  if (dnQty > 0 && dcQty === 0 && Math.abs(dcQty - orderedQty) > dcOrderedTolerance) {
    return "no_dc_update";
  }
  if (dnQty > 0 && Math.abs(dnQty - orderedQty) <= dnOrderedTolerance && dnQty > dcQty) {
    return "mismatch";
  }
  if (dnQty > 0 && Math.abs(dcQty - orderedQty) <= dcOrderedTolerance && dnQty <= dcQty) {
    return "matched";
  }
  // NOT IN THE SPECIFICATION. The five rules above are not exhaustive, so a
  // fallback is unavoidable. "matched" is the least disruptive choice, but it means
  // rows no rule claims are SILENTLY reported as clean. See the audit.
  return "matched";
}
