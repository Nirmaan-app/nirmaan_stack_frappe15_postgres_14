import { useStateSyncedWithParams } from "@/hooks/useSearchParamsManager";
import React, { Suspense } from "react";
import { TailSpin } from "react-loader-spinner";

export const RenderPurchaseOrdersTab : React.FC = () => {

  const [tab] = useStateSyncedWithParams<string>("tab", "Approved PO");

  // const ApprovePO = React.lazy(() => import("@/pages/ProcurementRequests/ApproveVendorQuotes/approve-r-reject-vendor-quotes"));

  const ApproveRejectVendorQuotesContainer = React.lazy(() => import("@/pages/ProcurementRequests/ApproveVendorQuotes/ApproveRejectVendorQuotesContainer"));

  const ApproveAmendedPO = React.lazy(() => import("@/pages/ProcurementOrders/approve-amend-po"));

  // const ApproveSentBackPO = React.lazy(() => import("@/pages/Sent Back Requests/ApproveSBVendorQuotes"));

  const ApproveSBSQuotesContainer = React.lazy(() => import("@/pages/Sent Back Requests/ApproveSBSQuotesContainer"));

  const PurchaseOrder = React.lazy(() => import("@/pages/ProcurementOrders/PurchaseOrder"));

  return (
    <Suspense fallback={
       <div className="flex items-center h-[90vh] w-full justify-center">
            <TailSpin color={"red"} />{" "}
        </div>
    }>
        {tab === "Approve PO" ? (
            <ApproveRejectVendorQuotesContainer />
          ) : tab === "Approve Amended PO" ? (
            <ApproveAmendedPO />
          ) : tab === "Approve Sent Back PO" ? (
            <ApproveSBSQuotesContainer /> 
          ) : (
            <PurchaseOrder />
          )}
    </Suspense>
  )
}