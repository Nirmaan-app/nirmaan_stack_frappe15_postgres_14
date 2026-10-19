import type { VendorRefundRow } from "@/components/vendor-refunds/useVendorRefunds";
import { mergePaymentsAndRefunds } from "@/components/vendor-refunds/VendorRefundTableRow";
import { VENDOR_REFUND_STATUS } from "@/types/NirmaanStack/VendorRefunds";
import { parseNumber } from "@/utils/parseNumber";
import type { WorkOrderTds } from "./tdsForecast";

/**
 * The rows of the payments pop-up opened from an order's Amount Paid (#1460, ADR-0034 point 4): its Paid
 * payments and its Received refunds as one list, newest first, and their net -- the order's Amount Paid.
 * Waiting and Cancelled refunds moved no money, so they are not listed.
 *
 * A Work Order's Amount Paid also holds the TDS withheld from the vendor on each payment (ADR-0034
 * Amendment A, #1512), so each payment row carries it as `tds` and the total counts it: payments + TDS
 * withheld - Received refunds. `deductions` is the server's per-payment answer (`get_work_order_tds`
 * `payments`); tax the company paid on top (`borne_by` Company) was never the vendor's and reads 0. A PO,
 * or a Work Order whose answer has not arrived, has none.
 */
export const paymentsDialogRows = <P extends { name: string; amount?: number | string | null; payment_date?: string | null }>(
  payments: P[] | undefined,
  refunds: VendorRefundRow[] | undefined,
  deductions?: WorkOrderTds["payments"]
) => {
  const received = (refunds ?? []).filter((refund) => refund.status === VENDOR_REFUND_STATUS.RECEIVED);
  const rows = mergePaymentsAndRefunds(payments, received).map((row) => {
    const deduction = row.kind === "payment" ? deductions?.[row.name] : undefined;
    return { ...row, tds: deduction?.borne_by === "Vendor" ? parseNumber(deduction.tds_amount) : 0 };
  });
  const total = rows.reduce(
    (sum, row) =>
      row.kind === "payment"
        ? sum + parseNumber(row.payment.amount as number) + row.tds
        : sum - parseNumber(row.refund.amount),
    0
  );
  return { rows, total };
};
