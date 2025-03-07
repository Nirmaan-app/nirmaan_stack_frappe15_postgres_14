import { SentBackSummary } from "@/pages/Sent Back Requests/sent-back-summary";
import React from "react";
import { useSearchParams } from "react-router-dom";
import { SBQuotesSelectionReview } from "./SBQuotesSelectionReview";
import { SentBackVendorQuotes } from "./SentBackVendorQuotes";

export const RenderSentBackComponent : React.FC = () => {
    const [searchParams] = useSearchParams();

    const mode = searchParams.get("mode") || "summary";

    if (mode === "summary") {
        return <SentBackSummary />
    }

    if(["edit", "view"].includes(mode)) {
      return <SentBackVendorQuotes />
    }

    if(mode === "review") {
        return <SBQuotesSelectionReview />
    }
    return (
        <div>Hello</div>
    )
}