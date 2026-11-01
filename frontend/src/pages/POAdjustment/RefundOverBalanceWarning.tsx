import React from "react";
import { Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import formatToIndianRupee, { formatToIndianRupeeOrZero } from "@/utils/FormatPrice";
import { poRefundsTarget, useVendorRefunds } from "@/components/vendor-refunds/useVendorRefunds";
import { VENDOR_REFUND_STATUS } from "@/types/NirmaanStack/VendorRefunds";

interface RefundOverBalanceWarningProps {
  poId: string | undefined;
  /** The PO's status, total (incl. GST) and stored Amount Paid (Paid payments less Received refunds). */
  status: string | undefined;
  totalAmount: number | undefined;
  amountPaid: number | undefined;
}

/** POs whose money is counted elsewhere or no longer tracked here: no warning. */
const NO_WARNING_STATUSES = ["Inactive", "Cancelled", "Merged", "PO Amendment"];

/**
 * How much the vendor holds above the PO total (owner 2026-10-31: warn only on an overpaid PO). Amount
 * Paid already has Received refunds taken off, so a refund that brought the PO back to its total leaves
 * nothing. 0 below ₹1. Pure.
 */
export function poOverpaidBy(
  status: string | undefined,
  totalAmount: number | undefined,
  amountPaid: number | undefined
): number {
  if (!status || NO_WARNING_STATUSES.includes(status)) return 0;
  const over = (Number(amountPaid) || 0) - (Number(totalAmount) || 0);
  return over >= 1 ? Math.round(over * 100) / 100 : 0;
}

/**
 * Warns when the vendor has been paid more than the PO total, after any Received Vendor Refunds. A refund
 * is never settled by revising the PO (owner 2026-10-31), so this never asks for a revision.
 */
export const RefundOverBalanceWarning: React.FC<RefundOverBalanceWarningProps> = ({
  poId,
  status,
  totalAmount,
  amountPaid,
}) => {
  const { refunds } = useVendorRefunds(poRefundsTarget(poId ?? ""));
  const over = poOverpaidBy(status, totalAmount, amountPaid);
  if (over <= 0) return null;

  const refunded = (refunds ?? [])
    .filter((r) => r.status === VENDOR_REFUND_STATUS.RECEIVED)
    .reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

  return (
    <Alert className="mb-6 bg-amber-50 border-amber-200">
      <Info className="h-4 w-4 text-amber-600" />
      <AlertTitle className="text-amber-800 font-semibold">
        This PO is overpaid by {formatToIndianRupee(over)}
      </AlertTitle>
      <AlertDescription className="text-amber-700 mt-2 text-sm space-y-1">
        <p className="tabular-nums">
          PO total {formatToIndianRupeeOrZero(totalAmount)} · Paid {formatToIndianRupeeOrZero(amountPaid)}
          {refunded > 0 && <> (after {formatToIndianRupee(refunded)} refunded)</>}
        </p>
        <p>
          The vendor holds {formatToIndianRupee(over)} more than this PO is worth. Record their refund when
          it comes back, or use it as credit on another PO.
        </p>
      </AlertDescription>
    </Alert>
  );
};
