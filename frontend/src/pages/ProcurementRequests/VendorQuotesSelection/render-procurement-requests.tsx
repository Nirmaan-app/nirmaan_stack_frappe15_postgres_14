import React, { Suspense } from "react";
import { TailSpin } from "react-loader-spinner";
import { useSearchParams } from "react-router-dom";

export const RenderProcurementRequest: React.FC = () => {

    const [searchParams] = useSearchParams();

   const tab = searchParams.get("tab") || "New PR Request"

   const mode = searchParams.get("mode") || "edit"

//    const ApprovePRList = React.lazy(() => import("../ApproveNewPR/approve-order"));



    const ApprovePRContainer = React.lazy(() => import("../ApproveNewPR/ApprovePRContainer"));
   const ProcurementOrder = React.lazy(() => import("./procurement-vendor"));

   const VendorsSelectionSummary = React.lazy(() => import("./VendorsSelectionSummary"));

   const ProcurementProgress = React.lazy(() => import("./ProcurementProgress"));

   return (
             <Suspense fallback={
                <div className="flex items-center h-[90vh] w-full justify-center">
                     <TailSpin color={"red"} />{" "}
                 </div>
             }>
                 {tab === "Approve PR" ? <ApprovePRContainer /> : tab === "New PR Request" ? <ProcurementOrder /> : tab === "In Progress"  && mode === "review" ? <VendorsSelectionSummary /> : <ProcurementProgress />}
             </Suspense>
        )
}