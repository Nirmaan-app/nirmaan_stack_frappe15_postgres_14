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

/** A PO line as the project's PO summary returns it (`generate_po_summary`). */
export interface POItemForPaid {
  po_number: string;
  work_package: string;
  quote: number;
  quantity: number;
  tax: number;
  isCustom?: boolean;
}

/**
 * The POs' Amount Paid grouped by work package, for the Spends tab.
 *
 * A PO's work package comes from its items, keyed as the Spends tab keys them ("Custom" for a custom
 * PO's items). A PO whose items span several packages shares its Amount Paid among them in proportion
 * to each package's item value incl. GST (evenly by item count when every item is priced at zero). A
 * PO with no items in `items` (Merged, Inactive) is left out.
 */
export function amountPaidByWorkPackage(
  pos: ReadonlyArray<{ name: string; amount_paid?: number | string | null }>,
  items: ReadonlyArray<POItemForPaid>,
): Record<string, number> {
  const valueByPO = new Map<string, Map<string, number>>();
  const countByPO = new Map<string, Map<string, number>>();
  for (const item of items) {
    const workPackage = item.isCustom ? "Custom" : item.work_package;
    const value = parseNumber(item.quote) * parseNumber(item.quantity) * (1 + parseNumber(item.tax) / 100);
    const values = valueByPO.get(item.po_number) ?? new Map<string, number>();
    const counts = countByPO.get(item.po_number) ?? new Map<string, number>();
    values.set(workPackage, (values.get(workPackage) || 0) + value);
    counts.set(workPackage, (counts.get(workPackage) || 0) + 1);
    valueByPO.set(item.po_number, values);
    countByPO.set(item.po_number, counts);
  }

  const paid: Record<string, number> = {};
  for (const po of pos) {
    const values = valueByPO.get(po.name);
    if (!values) continue;
    const totalValue = [...values.values()].reduce((sum, value) => sum + value, 0);
    const weights = totalValue > 0 ? values : countByPO.get(po.name)!;
    const totalWeight = [...weights.values()].reduce((sum, weight) => sum + weight, 0);
    for (const [workPackage, weight] of weights) {
      paid[workPackage] = (paid[workPackage] || 0) + (parseNumber(po.amount_paid) * weight) / totalWeight;
    }
  }
  return paid;
}
