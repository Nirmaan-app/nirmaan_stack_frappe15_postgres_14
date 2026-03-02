import React from "react";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Link } from "react-router-dom";
import { usePOLockCheck } from "./data/usePORevisionQueries";

interface PORevisionWarningProps {
  poId: string | undefined;
}

export const PORevisionWarning: React.FC<PORevisionWarningProps> = ({ poId }) => {
  const { data: warningData, isLoading } = usePOLockCheck(poId);

  if (isLoading || !warningData?.is_locked) return null;

  return (
    <Alert variant="destructive" className="mb-6 bg-red-50 border-red-200">
      <AlertCircle className="h-4 w-4 text-red-600" />
      <AlertTitle className="text-red-800 font-semibold">
        PO Locked by Pending Revision
      </AlertTitle>
      <AlertDescription className="text-red-700 mt-2 flex items-center justify-between">
        <span>
          This Purchase Order is currently locked because it is involved in a Pending PO Revision
          {warningData.role ? ` as the ${warningData.role}` : ""}. 
          No further payments or amendments can be processed until the revision is approved or rejected.
        </span>
        {warningData.revision_id && (
          <Link
            to={`/po-revisions-approval/${warningData.revision_id.replaceAll("/", "&=")}`}
            className="ml-4 whitespace-nowrap bg-red-100 hover:bg-red-200 text-red-800 px-3 py-1 rounded-md text-sm font-medium transition-colors"
          >
            View Revision {warningData.revision_id}
          </Link>
        )}
      </AlertDescription>
    </Alert>
  );
};
