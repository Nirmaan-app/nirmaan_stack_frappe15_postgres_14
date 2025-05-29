import { useUrlParam } from "@/hooks/useUrlParam";
import React, { Suspense } from "react";
import { TailSpin } from "react-loader-spinner";


const SentBackSummary = React.lazy(() => import("./sent-back-summary"));
// const SentBackVendorQuotes = React.lazy(() => import("./SentBackVendorQuotes"));
const SBQuotesSelectionReview = React.lazy(() => import("./SBQuotesSelectionReview"));

const ProcurementProgressContainer = React.lazy(() => import("../ProcurementRequests/VendorQuotesSelection/ProcurementProgressContainer"));

export const RenderSentBackComponent : React.FC = () => {

    const mode = useUrlParam("mode") || "summary";

    return (
        <Suspense fallback={
               <div className="flex items-center h-[90vh] w-full justify-center">
                    <TailSpin color={"red"} />{" "}
                </div>
            }>
                {mode === "summary" ? (
                    <SentBackSummary />
                  ) : ["edit", "view"].includes(mode) ? (
                    <ProcurementProgressContainer />
                  ) : mode === "review" ? (
                    <SBQuotesSelectionReview /> 
                  ) : (
                    <div>Invalid mode</div>
                  )}
        </Suspense>
    )
}