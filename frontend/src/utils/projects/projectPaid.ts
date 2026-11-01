/**
 * The project page's paid figures, read off the orders' stored Amount Paid (ADR-0034).
 *
 * `amount_paid` on a PO / Work Order is already its Paid payments less its Received Vendor Refunds,
 * so these rules only total or compare it. None of them adds up payments.
 */
import { parseNumber } from "@/utils/parseNumber";

export type OrderPaymentStatus = "Fully Paid" | "Partially Paid" | "Unpaid";

/** Short of the total by less than this is paisa rounding, not money still owed (ADR-0034's ₹1). */
const ROUNDING_TOLERANCE = 1;

/** An order's paid badge: its Amount Paid against its total (incl. GST). */
export function orderPaymentStatus(amountPaid: number, totalWithTax: number): OrderPaymentStatus {
  if (amountPaid <= 0) return "Unpaid";
  if (totalWithTax - amountPaid < ROUNDING_TOLERANCE) return "Fully Paid";
  return "Partially Paid";
}

/** The sum of the orders' stored Amount Paid. */
export function sumAmountPaid(orders: ReadonlyArray<{ amount_paid?: number | string | null }>): number {
  return orders.reduce((total, order) => total + parseNumber(order.amount_paid), 0);
}
