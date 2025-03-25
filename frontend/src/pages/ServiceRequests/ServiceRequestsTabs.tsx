import { useUserData } from "@/hooks/useUserData";
import { useDocCountStore } from "@/zustand/useDocCountStore";
import { Radio } from "antd";
import React, { Suspense, useCallback, useMemo, useState } from "react";
import { TailSpin } from "react-loader-spinner";
import { useSearchParams } from "react-router-dom";

const SelectServiceVendorList = React.lazy(() => import("./service-request/select-service-vendor-list"));
const ApproveSelectSR = React.lazy(() => import("./service-request/approve-service-request-list"));
const ApproveSelectAmendSR = React.lazy(() => import("./service-request/approve-amend-sr-list"));
const ApprovedSRList = React.lazy(() => import("./service-request/approved-sr-list"));

export const ServiceRequestsTabs : React.FC = () => {
    const [searchParams] = useSearchParams();

    const {role} = useUserData();

    const [tab, setTab] = useState<string>(searchParams.get("tab") || (["Nirmaan Admin Profile", "Nirmaan Project Lead Profile"].includes(role) ? "approve-service-order" : "choose-vendor"));

    const {pendingSRCount, adminPendingSRCount, approvedSRCount, adminApprovedSRCount, adminAmendedSRCount, amendedSRCount, adminSelectedSRCount, selectedSRCount} = useDocCountStore()

    const adminTabs = useMemo(() => [
        ...(["Nirmaan Admin Profile", "Nirmaan Project Lead Profile"].includes(role)  ? [
            {
                label: (
                    <div className="flex items-center">
                        <span>Approve Service Order</span>
                        <span className="ml-2 text-xs font-bold">
                            {role === "Nirmaan Admin Profile" ? adminSelectedSRCount : selectedSRCount}
                        </span>
                    </div>
                ),
                value: "approve-service-order",
            },
            {
                label: (
                    <div className="flex items-center">
                        <span>Approve Amended SO</span>
                        <span className="ml-2 text-xs font-bold">
                            {role === "Nirmaan Admin Profile" ? adminAmendedSRCount : amendedSRCount}
                        </span>
                    </div>
                ),
                value: "approve-amended-so",

            }
        ] : []),
    ], [role, adminSelectedSRCount, selectedSRCount, adminAmendedSRCount, amendedSRCount]);

    const items = useMemo(() => [
        {
          label: (
              <div className="flex items-center">
                  <span>In Progress SR</span>
                  <span className="ml-2 text-xs font-bold">
                      {role === "Nirmaan Admin Profile" ? adminPendingSRCount : pendingSRCount}
                  </span>
              </div>
          ),
          value: "choose-vendor",
      },
      {
          label: (
              <div className="flex items-center">
                  <span>Approved SR</span>
                  <span className="ml-2 rounded text-xs font-bold">
                      {role === "Nirmaan Admin Profile" ? adminApprovedSRCount : approvedSRCount}
                  </span>
              </div>
          ),
          value: "approved-sr",
      },
  ], [role, adminPendingSRCount, pendingSRCount, adminApprovedSRCount, approvedSRCount]);

  const updateURL = useCallback((key : string, value : string) => {
      const url = new URL(window.location.href);
      url.searchParams.set(key, value);
      window.history.pushState({}, "", url);
  }, []);

  const onClick = useCallback((value : string) => {
      if (tab === value) return;
      setTab(value);
      updateURL("tab", value);
  }, [tab, updateURL]);

  return (
    <div className="flex-1 space-y-4">
        <div className="flex items-center max-sm:items-start gap-4 max-sm:flex-col">
            {adminTabs && (
                <Radio.Group
                    options={adminTabs}
                    optionType="button"
                    buttonStyle="solid"
                    value={tab}
                    onChange={(e) => onClick(e.target.value)}
                />
            )}
          {items && (
              <Radio.Group
                  options={items}
                  optionType="button"
                  buttonStyle="solid"
                  value={tab}
                  onChange={(e) => onClick(e.target.value)}
              />
          )}
        </div>

         <Suspense fallback={
            <div className="flex items-center h-[90vh] w-full justify-center">
                <TailSpin color={"red"} />{" "}
            </div>
        }>
            {tab === "choose-vendor" ? (
            <SelectServiceVendorList />
            ) : tab === "approve-service-order" ? (
              <ApproveSelectSR />
            ) : tab === "approve-amended-so" ? (
              <ApproveSelectAmendSR /> 
            ) : (
              <ApprovedSRList />
            )}
        </Suspense>
      </div>
  )
}