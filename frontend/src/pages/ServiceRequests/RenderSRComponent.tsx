import React, { Suspense } from "react";
import { TailSpin } from "react-loader-spinner";
import { useSearchParams } from "react-router-dom";

export const RenderSRComponent : React.FC = () => {

  const [searchParams] = useSearchParams();

  const tab = searchParams.get("tab") || "choose-vendor"

  const SelectServiceVendor = React.lazy(() => import("./service-request/select-service-vendor"));

  const ApprovedSR = React.lazy(() => import("./service-request/approved-sr"));

  const ApproveSR = React.lazy(() => import("./service-request/approve-service-request"));

  const ApproveAmendSR = React.lazy(() => import("./service-request/approve-amended-sr"));

  return (
    <Suspense fallback={
       <div className="flex items-center h-[90vh] w-full justify-center">
            <TailSpin color={"red"} />{" "}
        </div>
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