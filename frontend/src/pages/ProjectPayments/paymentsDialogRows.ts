import type { VendorRefundRow } from "@/components/vendor-refunds/useVendorRefunds";
import { mergePaymentsAndRefunds } from "@/components/vendor-refunds/VendorRefundTableRow";
import { TDS_BORNE_BY } from "@/types/NirmaanStack/PaymentTDSDeduction";
import { VENDOR_REFUND_STATUS } from "@/types/NirmaanStack/VendorRefunds";
import { parseNumber } from "@/utils/parseNumber";
import type { WorkOrderTds } from "./tdsForecast";

/**
 * The rows of the payments pop-up opened from an order's Amount Paid (#1460, ADR-0034 point 4): its Paid
 * payments and its Received refunds as one list, newest first, and their net -- the order's Amount Paid.
 * Waiting and Cancelled refunds moved no money, so they are not listed.
 *
 * An order's Amount Paid also holds the TDS withheld from the vendor on each payment (ADR-0034
 * Amendment A for a Work Order, #1512; Amendment B for a PO's recorded tax, #1534), so each payment row
 * carries it as `tds` and the total counts it: payments + TDS withheld - Received refunds. `deductions`
 * is the server's per-payment answer (`get_work_order_tds` / `get_order_payment_tds` `payments`); tax
 * the company paid on top (`borne_by` Company) was never the vendor's and reads 0. A PO payment still
 * stored gross has no counted deduction, so it reads 0 too.
 *
 * `tdsPending`: an order whose answer has not arrived. Its rows' `tds` and the `total` are undefined
 * then, never a total without the tax that the Amount Paid clicked holds.
 */
export const paymentsDialogRows = <P extends { name: string; amount?: number | string | null; payment_date?: string | null }>(
  payments: P[] | undefined,
  refunds: VendorRefundRow[] | undefined,
  deductions?: WorkOrderTds["payments"],
  tdsPending = false
) => {
  const received = (refunds ?? []).filter((refund) => refund.status === VENDOR_REFUND_STATUS.RECEIVED);
  const rows = mergePaymentsAndRefunds(payments, received).map((row) => {
    const deduction = row.kind === "payment" ? deductions?.[row.name] : undefined;
    const tds = deduction?.borne_by === TDS_BORNE_BY.VENDOR ? parseNumber(deduction.tds_amount) : 0;
    return { ...row, tds: tdsPending ? undefined : tds };
  });
  const total = tdsPending
    ? undefined
    : rows.reduce(
        (sum, row) =>
          row.kind === "payment"
            ? sum + parseNumber(row.payment.amount as number) + (row.tds ?? 0)
            : sum - parseNumber(row.refund.amount),
        0
      );
  return { rows, total };
};
