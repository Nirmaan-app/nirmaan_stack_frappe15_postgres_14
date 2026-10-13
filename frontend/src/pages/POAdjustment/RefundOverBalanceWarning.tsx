import React from "react";
import { Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import formatToIndianRupee from "@/utils/FormatPrice";
import { usePORefundLinks } from "./data/usePORefundLinks";

interface RefundOverBalanceWarningProps {
  poId: string | undefined;
}

/**
 * A Received Vendor Refund settles the PO Adjustment balance only up to that balance (#1399).
 * What it holds beyond is shown here: usually the vendor refunded before the revision that
 * cuts the PO was raised.
 */
export const RefundOverBalanceWarning: React.FC<RefundOverBalanceWarningProps> = ({ poId }) => {
  const { refundLinks } = usePORefundLinks(poId);
  const over = refundLinks?.over_balance ?? 0;
  if (over <= 0) return null;

  return (
    <Alert className="mb-6 bg-amber-50 border-amber-200">
      <Info className="h-4 w-4 text-amber-600" />
      <AlertTitle className="text-amber-800 font-semibold">
        Refund is {formatToIndianRupee(over)} more than overpaid. Revise the PO?
      </AlertTitle>
      <AlertDescription className="text-amber-700 mt-2 text-sm">
        The vendor has refunded {formatToIndianRupee(refundLinks?.received ?? 0)} on this PO, and{" "}
        {formatToIndianRupee(refundLinks?.linked ?? 0)} of it settles the PO Adjustment. A revision that
        cuts the PO by the rest will be settled by this refund when it is approved.
      </AlertDescription>
    </Alert>
  );
};
