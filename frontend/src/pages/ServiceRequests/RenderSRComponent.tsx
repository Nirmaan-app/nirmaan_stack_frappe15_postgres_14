import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { useUrlParam } from "@/hooks/useUrlParam";
import React, { Suspense } from "react";

export const RenderSRComponent : React.FC = () => {

  const tab = useUrlParam("tab") || "choose-vendor"

  const SelectServiceVendor = React.lazy(() => import("./service-request/select-service-vendor"));

  const ApprovedSR = React.lazy(() => import("./service-request/approved-sr"));
  // const ApprovedSRPage = React.lazy(() => import("./approved-sr/ApprovedSRPage"));

  const ApproveSR = React.lazy(() => import("./service-request/approve-service-request"));

  const ApproveAmendSR = React.lazy(() => import("./service-request/approve-amended-sr"));

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