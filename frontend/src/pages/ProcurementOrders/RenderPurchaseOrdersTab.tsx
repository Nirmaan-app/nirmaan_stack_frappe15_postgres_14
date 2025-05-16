import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { useUrlParam } from "@/hooks/useUrlParam";
import React, { Suspense } from "react";

export const RenderPurchaseOrdersTab : React.FC = () => {

  const tab = useUrlParam("tab") || "Approve PO";

  // const ApprovePO = React.lazy(() => import("@/pages/ProcurementRequests/ApproveVendorQuotes/approve-r-reject-vendor-quotes"));

  const ApproveRejectVendorQuotesContainer = React.lazy(() => import("@/pages/ProcurementRequests/ApproveVendorQuotes/ApproveRejectVendorQuotesContainer"));

  const ApproveAmendedPO = React.lazy(() => import("@/pages/ProcurementOrders/amend-po/approve-amend-po"));

  // const ApproveSentBackPO = React.lazy(() => import("@/pages/Sent Back Requests/ApproveSBVendorQuotes"));

  const ApproveSBSQuotesContainer = React.lazy(() => import("@/pages/Sent Back Requests/ApproveSBSQuotesContainer"));

  const PurchaseOrder = React.lazy(() => import("@/pages/ProcurementOrders/purchase-order/PurchaseOrder"));

  return (
    <Suspense fallback={
      <LoadingFallback />
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