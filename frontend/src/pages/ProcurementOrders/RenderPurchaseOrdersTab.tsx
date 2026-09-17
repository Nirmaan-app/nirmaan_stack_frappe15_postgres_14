import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { useUrlParam } from "@/hooks/useUrlParam";
import { useUserData } from "@/hooks/useUserData";
import React, { Suspense } from "react";
import { Navigate } from "react-router-dom";
import { PO_ADMIN_ROLES } from "./purchase-order/config/poTabs.constants";

export const RenderPurchaseOrdersTab : React.FC = () => {

  const tab = useUrlParam("tab") || "Approve PO";

  const { role, user_id } = useUserData();

  // PO approval authority — single source of truth is PO_ADMIN_ROLES (which also drives the
  // "Approve …" tabs). Guarding here closes the direct-URL hole: the approve screens are reachable
  // by `?tab=Approve PO` (or no tab at all, which defaults to it) and the server does not check the
  // role. Non-approvers (e.g. PMO after the 2026-09-17 access review) are bounced to the PO list.
  const canApprovePO = PO_ADMIN_ROLES.includes(role ?? "") || user_id === "Administrator";

  // const ApprovePO = React.lazy(() => import("@/pages/ProcurementRequests/ApproveVendorQuotes/approve-r-reject-vendor-quotes"));

  const ApproveRejectVendorQuotesContainer = React.lazy(() => import("@/pages/ProcurementRequests/ApproveVendorQuotes/ApproveRejectVendorQuotesContainer"));

  // const ApproveSentBackPO = React.lazy(() => import("@/pages/Sent Back Requests/ApproveSBVendorQuotes"));

  const ApproveSBSQuotesContainer = React.lazy(() => import("@/pages/Sent Back Requests/ApproveSBSQuotesContainer"));

  const PurchaseOrder = React.lazy(() => import("@/pages/ProcurementOrders/purchase-order/PurchaseOrder"));

  if ((tab === "Approve PO" || tab === "Approve Sent Back PO") && !canApprovePO) {
    // Wait for the role: while it loads it reads "Loading", and redirecting then would bounce a
    // real approver who opened the link fresh.
    if (role === "Loading") return <LoadingFallback />;
    return <Navigate to="/purchase-orders" replace />;
  }

  return (
    <Suspense fallback={
      <LoadingFallback />
    }>
        {tab === "Approve PO" ? (
            <ApproveRejectVendorQuotesContainer />
          ) : tab === "Approve Sent Back PO" ? (
            <ApproveSBSQuotesContainer />
          ) : (
            <PurchaseOrder />
          )}
    </Suspense>
  )
}
