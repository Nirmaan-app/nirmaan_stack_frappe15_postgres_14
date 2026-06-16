import React from "react";
import { AlertCircle, Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Link } from "react-router-dom";
import { usePOLockCheck } from "./data/usePORevisionQueries";
import { useUserData } from "@/hooks/useUserData";
import formatToIndianRupee from "@/utils/FormatPrice";

interface PORevisionWarningProps {
  poId: string | undefined;
}

export const PORevisionWarning: React.FC<PORevisionWarningProps> = ({ poId }) => {
  const { data: warningData, isLoading } = usePOLockCheck(poId);
  const { role } = useUserData();

  const canViewRevision = ["Nirmaan Admin Profile", "Nirmaan Accountant Profile", "Nirmaan Accountant Lead Profile", "Nirmaan PMO Executive Profile"].includes(role);

  const isItemLocked = warningData?.is_item_locked || false;
  const isPaymentLocked = warningData?.is_payment_locked || false;
  const hasCreditNotice = warningData?.has_credit_notice || false;
  const remainingCredit = warningData?.remaining_credit || 0;

  if (isLoading) return null;

  // HARD lock (Pending revision or Pending adjustment) → blocking red alert.
  if (isItemLocked || isPaymentLocked) {
    const paymentLockSource = warningData?.payment_lock_source;
    const lockDescription = isItemLocked && isPaymentLocked
      ? "Items and payments are locked"
      : isItemLocked
      ? "Items are locked (dispatch, DN, merge blocked)"
      : `Payments are locked${paymentLockSource ? ` by ${paymentLockSource}` : ""}`;

    return (
      <Alert variant="destructive" className="mb-6 bg-red-50 border-red-200">
        <AlertCircle className="h-4 w-4 text-red-600" />
        <AlertTitle className="text-red-800 font-semibold">
          PO Locked — {lockDescription}
        </AlertTitle>
        <AlertDescription className="text-red-700 mt-2 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <span className="text-sm">
            This Purchase Order is currently locked because it is involved in a Pending {paymentLockSource || "PO Revision"}
            {warningData?.role ? ` as the ${warningData?.role}` : ""}.
            {isItemLocked ? " No dispatch, delivery notes, or merge operations can be processed." : ""}
            {isPaymentLocked ? " No payment term changes can be processed." : ""}
          </span>
          {warningData?.revision_id && (
            canViewRevision ? (
              <Link
                to={`/po-revisions-approval/${warningData.revision_id.replace(/\//g, "&=")}`}
                className="whitespace-nowrap bg-red-300 hover:bg-red-400 text-red-900 px-3 py-1 rounded-md text-sm font-medium transition-colors text-center shrink-0"
              >
                View Revision {warningData.revision_id}
              </Link>
            ) : (
              <span className="whitespace-nowrap text-red-800 text-sm font-medium shrink-0">
                Revision: {warningData.revision_id}
              </span>
            )
          )}
        </AlertDescription>
      </Alert>
    );
  }

  // SOFT advisory: a 'Done' adjustment still holds small overpaid credit.
  // Payment terms are NOT blocked — this is purely informational.
  if (hasCreditNotice) {
    return (
      <Alert className="mb-6 bg-amber-50 border-amber-200">
        <Info className="h-4 w-4 text-amber-600" />
        <AlertTitle className="text-amber-800 font-semibold">
          Overpaid credit available — {formatToIndianRupee(remainingCredit)}
        </AlertTitle>
        <AlertDescription className="text-amber-700 mt-2 text-sm">
          This Purchase Order still holds {formatToIndianRupee(remainingCredit)} of overpaid credit.
          It will be applied automatically to the next revision increase, or can be transferred/refunded
          from the PO Adjustment. Payment terms are not blocked.
        </AlertDescription>
      </Alert>
    );
  }

  return null;
};
