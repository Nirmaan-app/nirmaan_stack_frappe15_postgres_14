import type { VendorRefundRow } from "@/components/vendor-refunds/useVendorRefunds";
import { mergePaymentsAndRefunds } from "@/components/vendor-refunds/VendorRefundTableRow";
import { VENDOR_REFUND_STATUS } from "@/types/NirmaanStack/VendorRefunds";
import { parseNumber } from "@/utils/parseNumber";

/**
 * The rows of the payments pop-up opened from an order's Amount Paid (#1460, ADR-0034 point 4): its Paid
 * payments and its Received refunds as one list, newest first, and their net -- the order's Amount Paid.
 * Waiting and Cancelled refunds moved no money, so they are not listed.
 */
export const paymentsDialogRows = <P extends { name: string; amount?: number | string | null; payment_date?: string | null }>(
  payments: P[] | undefined,
  refunds: VendorRefundRow[] | undefined
) => {
  const received = (refunds ?? []).filter((refund) => refund.status === VENDOR_REFUND_STATUS.RECEIVED);
  const rows = mergePaymentsAndRefunds(payments, received);
  const total = rows.reduce(
    (sum, row) =>
      row.kind === "payment" ? sum + parseNumber(row.payment.amount as number) : sum - parseNumber(row.refund.amount),
    0
  );
  return { rows, total };
};
