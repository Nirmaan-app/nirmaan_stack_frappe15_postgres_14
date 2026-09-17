import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { useUrlParam } from "@/hooks/useUrlParam";
import { useUserData } from "@/hooks/useUserData";
import React, { Suspense } from "react";
import { Navigate } from "react-router-dom";
import { SR_ADMIN_ROLES } from "./config/srTabs.constants";

export const RenderSRComponent : React.FC = () => {

  const tab = useUrlParam("tab") || "choose-vendor"

  const { role, user_id } = useUserData();

  // WO approval authority — single source of truth is SR_ADMIN_ROLES (which also drives the
  // "Approve WO" tabs). Guarding here closes the direct-URL hole: hiding the tab alone is cosmetic.
  // Non-approvers (e.g. PMO after the 2026-09-17 access review) are bounced to the WO list.
  const canApproveWO = SR_ADMIN_ROLES.includes(role ?? "") || user_id === "Administrator";

  const SelectServiceVendor = React.lazy(() => import("./service-request/select-service-vendor"));

  const ApprovedSR = React.lazy(() => import("./service-request/approved-sr"));
  // const ApprovedSRPage = React.lazy(() => import("./approved-sr/ApprovedSRPage"));

  const ApproveSR = React.lazy(() => import("./service-request/approve-service-request"));

  const ApproveAmendSR = React.lazy(() => import("./service-request/approve-amended-sr"));

  if ((tab === "approve-service-order" || tab === "approve-amended-so") && !canApproveWO) {
    // Wait for the role: while it loads it reads "Loading", and redirecting then would bounce a
    // real approver who opened the link fresh.
    if (role === "Loading") return <LoadingFallback />;
    return <Navigate to="/service-requests" replace />;
  }

  return (
    <Suspense fallback={
       <LoadingFallback />
    }>
            {tab === "choose-vendor" ? (
                  <SelectServiceVendor />
                ) : tab === "approve-service-order" ? (
                  <ApproveSR />
                ) : tab === "approve-amended-so" ? (
                  <ApproveAmendSR />
                ) : (
                  <ApprovedSR />
                )}
    </Suspense>
  )
}
