import React, { Suspense } from "react";
import { TailSpin } from "react-loader-spinner";
import { useSearchParams } from "react-router-dom";


const SentBackSummary = React.lazy(() => import("./sent-back-summary"));
const SentBackVendorQuotes = React.lazy(() => import("./SentBackVendorQuotes"));
const SBQuotesSelectionReview = React.lazy(() => import("./SBQuotesSelectionReview"));

export const RenderSentBackComponent : React.FC = () => {
    const [searchParams] = useSearchParams();

    const mode = searchParams.get("mode") || "summary";

    return (
        <Suspense fallback={
               <div className="flex items-center h-[90vh] w-full justify-center">
                    <TailSpin color={"red"} />{" "}
                </div>
            }>
                {mode === "summary" ? (
                    <SentBackSummary />
                  ) : ["edit", "view"].includes(mode) ? (
                    <SentBackVendorQuotes />
                  ) : mode === "review" ? (
                    <SBQuotesSelectionReview /> 
                  ) : (
                    <div>Invalid mode</div>
                  )}
        </Suspense>
    )
}