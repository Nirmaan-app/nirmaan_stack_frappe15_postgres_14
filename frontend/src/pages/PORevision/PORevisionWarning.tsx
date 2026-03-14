import React from "react";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Link } from "react-router-dom";
import { usePOLockCheck } from "./data/usePORevisionQueries";
import { useUserData } from "@/hooks/useUserData";

interface PORevisionWarningProps {
  poId: string | undefined;
}

export const PORevisionWarning: React.FC<PORevisionWarningProps> = ({ poId }) => {
  const { data: warningData, isLoading } = usePOLockCheck(poId);
  const { role } = useUserData();

  const canViewRevision = ["Nirmaan Admin Profile", "Nirmaan Accountant Profile", "Nirmaan PMO Executive Profile"].includes(role);

  const isItemLocked = warningData?.is_item_locked || false;
  const isPaymentLocked = warningData?.is_payment_locked || false;

  if (isLoading || (!isItemLocked && !isPaymentLocked)) return null;

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
};
