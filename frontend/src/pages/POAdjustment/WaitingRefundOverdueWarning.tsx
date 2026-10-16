import React, { useMemo } from "react";
import { Clock } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { poRefundsTarget, useVendorRefunds } from "@/components/vendor-refunds/useVendorRefunds";
import {
  isOverdueWaitingRefund,
  WAITING_REFUND_OVERDUE_DAYS,
} from "@/components/vendor-refunds/waitingRefundExits";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";

interface WaitingRefundOverdueWarningProps {
  poId: string | undefined;
}

/**
 * A waiting Vendor Refund on this PO has waited more than 15 days for its bank line (#1403). It
 * still holds its credit and keeps the PO locked; the warning says so and points at the ways out
 * in Transaction Details (Cancel, or an Admin's Mark received).
 */
export const WaitingRefundOverdueWarning: React.FC<WaitingRefundOverdueWarningProps> = ({ poId }) => {
  const { refunds } = useVendorRefunds(poRefundsTarget(poId ?? ""));
  const overdue = useMemo(() => (refunds ?? []).filter((r) => isOverdueWaitingRefund(r)), [refunds]);
  if (overdue.length === 0) return null;

  return (
    <Alert className="mb-6 bg-amber-50 border-amber-200">
      <Clock className="h-4 w-4 text-amber-600" />
      <AlertTitle className="text-amber-800 font-semibold">
        {overdue.length === 1 ? "A refund has" : `${overdue.length} refunds have`} waited more than{" "}
        {WAITING_REFUND_OVERDUE_DAYS} days for the bank line
      </AlertTitle>
      <AlertDescription className="text-amber-700 mt-2 text-sm">
        <ul className="list-disc pl-4">
          {overdue.map((r) => (
            <li key={r.name}>
              {r.name}: {formatToIndianRupee(r.amount)}, recorded {formatDate(r.creation.replace(" ", "T"))}
            </li>
          ))}
        </ul>
        <p className="mt-1">
          Check the bank statement. If the money never came, cancel the refund in Transaction Details; if it
          came but the bank line cannot be found, an Admin can mark it received with no bank line.
        </p>
      </AlertDescription>
    </Alert>
  );
};
