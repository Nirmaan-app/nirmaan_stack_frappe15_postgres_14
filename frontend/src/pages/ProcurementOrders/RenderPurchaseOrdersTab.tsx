import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { useUrlParam } from "@/hooks/useUrlParam";
import { useUserData } from "@/hooks/useUserData";
import React, { Suspense } from "react";
import { Navigate } from "react-router-dom";
import { PO_ADMIN_ROLES, PO_TABS } from "./purchase-order/config/poTabs.constants";

// Module level, never inside the component: `React.lazy` returns a NEW component type on every
// call, so creating these per render made React unmount and remount the whole screen whenever this
// wrapper re-rendered -- which `useUrlParam` (it reads `useLocation`) does on every URL change,
// e.g. the payment-terms dialog clearing `?isEditing=true`, and `useUserData` does once when the
// role finishes loading. Each remount refetched the PO and dropped open dialogs and accordions.
const ApproveRejectVendorQuotesContainer = React.lazy(() => import("@/pages/ProcurementRequests/ApproveVendorQuotes/ApproveRejectVendorQuotesContainer"));
const ApproveSBSQuotesContainer = React.lazy(() => import("@/pages/Sent Back Requests/ApproveSBSQuotesContainer"));
const PurchaseOrder = React.lazy(() => import("@/pages/ProcurementOrders/purchase-order/PurchaseOrder"));

export const RenderPurchaseOrdersTab : React.FC = () => {

  // The approve screens take a PR / Sent Back id and are reached ONLY by naming their tab (the
  // approve lists and every backend notification do). Anything else -- no tab, or any list tab --
  // is a PO id, so it opens the PO. This used to default to "Approve PO", which sent a bare
  // `/purchase-orders/<PO>` link to the PR approval screen looking the PO up as a PR.
  const tab = useUrlParam("tab");
  const isApproveTab = tab === PO_TABS.APPROVE_PO || tab === PO_TABS.APPROVE_SENT_BACK_PO;

  const { role, user_id } = useUserData();

  // PO approval authority — single source of truth is PO_ADMIN_ROLES (which also drives the
  // "Approve …" tabs). Guarding here closes the direct-URL hole: the approve screens are reachable
  // by `?tab=Approve PO` / `?tab=Approve Sent Back PO` and the server does not check the role.
  // Non-approvers (e.g. PMO after the 2026-09-17 access review) are bounced to the PO list.
  const canApprovePO = PO_ADMIN_ROLES.includes(role ?? "") || user_id === "Administrator";

  if (isApproveTab && !canApprovePO) {
    // Wait for the role: while it loads it reads "Loading", and redirecting then would bounce a
    // real approver who opened the link fresh.
    if (role === "Loading") return <LoadingFallback />;
    return <Navigate to="/purchase-orders" replace />;
  }

  return (
    <Suspense fallback={
      <LoadingFallback />
    }>
        {tab === PO_TABS.APPROVE_PO ? (
            <ApproveRejectVendorQuotesContainer />
          ) : tab === PO_TABS.APPROVE_SENT_BACK_PO ? (
            <ApproveSBSQuotesContainer />
          ) : (
            <PurchaseOrder />
          )}
    </Suspense>
  )
}
