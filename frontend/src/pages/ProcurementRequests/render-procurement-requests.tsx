import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { useUrlParam } from "@/hooks/useUrlParam";
import { useUserData } from "@/hooks/useUserData";
import { Navigate } from "react-router-dom";
import React, { Suspense } from "react";
import { PR_ADMIN_ROLES } from "./config/prTabs.constants";

export const RenderProcurementRequest: React.FC = () => {

    const tab = useUrlParam("tab");
    const mode = useUrlParam("mode");

    const { role, user_id } = useUserData();

    // PR approval authority — single source of truth is PR_ADMIN_ROLES (config/prTabs.constants.ts,
    // which also drives the "Approve PR" tab visibility). Guarding here closes the direct-URL hole:
    // hiding the tab alone is cosmetic since the approve action is a raw updateDoc on the PR doc.
    // Non-approvers (e.g. PMO after the 2026-07-04 access review) are bounced to their default tab.
    const canApprovePR = PR_ADMIN_ROLES.includes(role ?? "") || user_id === "Administrator";

    //    const ApprovePRList = React.lazy(() => import("../ApproveNewPR/approve-order"));

    const ApprovePRContainer = React.lazy(() => import("./ApproveNewPR/ApprovePRContainer"));
    const ProcurementOrder = React.lazy(() => import("./VendorQuotesSelection/procurement-vendor"));

    const VendorsSelectionSummary = React.lazy(() => import("./VendorQuotesSelection/VendorsSelectionSummary"));

    // const ProcurementProgress = React.lazy(() => import("./VendorQuotesSelection/ProcurementProgress"));

    const ProcurementProgressContainer = React.lazy(() => import("./VendorQuotesSelection/ProcurementProgressContainer"));

    // const ProcurementProgressContainer = React.lazy(() => import("./ProcurementProgressContainer"));

    // Block non-approvers from the approve view even via a direct/bookmarked ?tab=Approve PR URL —
    // silently redirect them to their default PR tab.
    if (tab === "Approve PR" && !canApprovePR) {
        return <Navigate to="/procurement-requests?tab=New PR Request" replace />;
    }

    return (
        <Suspense fallback={
            <LoadingFallback />
        }>
            {tab === "Approve PR" ? <ApprovePRContainer /> : tab === "New PR Request" ? <ProcurementOrder /> : tab === "In Progress" && mode === "review" ? <VendorsSelectionSummary /> : <ProcurementProgressContainer />}
        </Suspense>
    )
}
