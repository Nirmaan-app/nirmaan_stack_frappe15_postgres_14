/**
 * DN vs DC status of one ITM item — the ITM rule, in one home.
 *
 * Read by the project ITM DN > DC Quantity Report (`ITMDNDCQuantityReport`) and by the
 * ITM page's Item-wise Delivery Challans & MIRs view, so the two never disagree.
 *
 * It is deliberately NOT the PO rule (`utils/dnDcStatus.ts`): it has no Partially
 * Delivered verdict, no tolerance, and never looks at the Transfer Qty. The owner chose
 * this rule for the ITM page on 2026-11-26.
 */

export type ITMDNDCStatus = "matched" | "mismatch" | "no_dc_update" | "pending_dn";

/**
 * The status of one ITM item from its received (DN) and challaned (DC) quantities.
 * First match wins:
 *   1. Pending DN    nothing received, but a DC was filed
 *   2. Matched       DC covers everything received (also: nothing received and no DC)
 *   3. No DC Update  something received, no DC at all
 *   4. Mismatch      something received, DC short of it
 */
export function itmDnDcItemStatus(dnQty: number, dcQty: number): ITMDNDCStatus {
  if (dnQty === 0 && dcQty > 0) return "pending_dn";
  if (dcQty >= dnQty) return "matched";
  if (dnQty > 0 && dcQty === 0) return "no_dc_update";
  return "mismatch";
}
