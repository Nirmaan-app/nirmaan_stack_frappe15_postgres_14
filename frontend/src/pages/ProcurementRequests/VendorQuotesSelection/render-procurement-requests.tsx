import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { useUrlParam } from "@/hooks/useUrlParam";
import React, { Suspense } from "react";

export const RenderProcurementRequest: React.FC = () => {

    const tab = useUrlParam("tab");
    const mode = useUrlParam("mode");

//    const ApprovePRList = React.lazy(() => import("../ApproveNewPR/approve-order"));

   const ApprovePRContainer = React.lazy(() => import("../ApproveNewPR/ApprovePRContainer"));
   const ProcurementOrder = React.lazy(() => import("./procurement-vendor"));

   const VendorsSelectionSummary = React.lazy(() => import("./VendorsSelectionSummary"));

   const ProcurementProgress = React.lazy(() => import("./ProcurementProgress"));

//    const ProcurementProgressContainer = React.lazy(() => import("./ProcurementProgressContainer"));

   return (
             <Suspense fallback={
                <LoadingFallback />
             }>
                 {tab === "Approve PR" ? <ApprovePRContainer /> : tab === "New PR Request" ? <ProcurementOrder /> : tab === "In Progress"  && mode === "review" ? <VendorsSelectionSummary /> : <ProcurementProgress />}
             </Suspense>
        )
}