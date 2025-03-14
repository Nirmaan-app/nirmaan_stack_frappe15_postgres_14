import React, { Suspense } from "react";
import { TailSpin } from "react-loader-spinner";
import { useSearchParams } from "react-router-dom";

export const RenderPurchaseOrdersTab : React.FC = () => {

  const [searchParams] = useSearchParams();

  const tab = searchParams.get("tab") || "Approved PO"

  const ApprovePO = React.lazy(() => import("@/pages/ProcurementRequests/ApproveVendorQuotes/approve-r-reject-vendor-quotes"));

  const ApproveAmendedPO = React.lazy(() => import("@/pages/approve-amend-po"));

  const ApproveSentBackPO = React.lazy(() => import("@/pages/Sent Back Requests/ApproveSBVendorQuotes"));

  const PurchaseOrder = React.lazy(() => import("@/pages/ProcurementOrders/PurchaseOrder"));

  return (
    <Suspense fallback={
       <div className="flex items-center h-[90vh] w-full justify-center">
            <TailSpin color={"red"} />{" "}
        </div>
    }>
            {tab === "Approve PO" ? (
                  <ApprovePO />
                ) : tab === "Approve Amended PO" ? (
                  <ApproveAmendedPO />
                ) : tab === "Approve Sent Back PO" ? (
                  <ApproveSentBackPO /> 
                ) : (
                  <PurchaseOrder />
                )}
    </Suspense>
  )
}