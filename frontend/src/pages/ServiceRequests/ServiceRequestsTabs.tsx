import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { getUrlStringParam } from "@/hooks/useServerDataTable";
import { useUserData } from "@/hooks/useUserData";
import { urlStateManager } from "@/utils/urlStateManager";
import { useDocCountStore } from "@/zustand/useDocCountStore";
import { Radio } from "antd";
import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";


const ApproveSelectSR = React.lazy(() => import("./service-request/approve-service-request-list"));
const ApproveSelectAmendSR = React.lazy(() => import("./service-request/approve-amend-sr-list"));
const SelectServiceVendorList = React.lazy(() => import("./service-request/select-service-vendor-list"));
const ApprovedSRList = React.lazy(() => import("./service-request/approved-sr-list"));

export const ServiceRequestsTabs : React.FC = () => {

    const {role} = useUserData();

    // --- Tab State Management using urlStateManager ---
    const initialTab = useMemo(() => {
        const adminDefault = "approve-service-order";
        const userDefault = "choose-vendor";
        return getUrlStringParam("tab", ["Nirmaan Admin Profile", "Nirmaan PMO Executive Profile", "Nirmaan Project Lead Profile"].includes(role) ? adminDefault : userDefault);
    }, [role]);

    const [tab, setTab] = useState<string>(initialTab);

    useEffect(() => { // Sync tab state TO URL
        if (urlStateManager.getParam("tab") !== tab) {
            urlStateManager.updateParam("tab", tab);
        }
    }, [tab]);
    
    useEffect(() => { // Sync URL TO tab state
        const unsubscribe = urlStateManager.subscribe("tab", (_, value) => {
            const newTab = value || initialTab;
            if (tab !== newTab) setTab(newTab);
        });
        return unsubscribe;
    }, [initialTab]);

    const {counts} = useDocCountStore()

    const adminTabs = useMemo(() => [
        ...(["Nirmaan Admin Profile", "Nirmaan PMO Executive Profile", "Nirmaan Project Lead Profile"].includes(role)  ? [
            {
                label: (
                    <div className="flex items-center">
                        <span>Approve Work Order</span>
                        <span className="ml-2 text-xs font-bold">
                            {counts.sr.selected}
                        </span>
                    </div>
                ),
                value: "approve-service-order",
            },
            {
                label: (
                    <div className="flex items-center">
                        <span>Approve Amended WO</span>
                        <span className="ml-2 text-xs font-bold">
                            {counts.sr.amended}
                        </span>
                    </div>
                ),
                value: "approve-amended-so",
            }
        ] : []),
    ], [role, counts]);

    const items = useMemo(() => [
        {
          label: (
              <div className="flex items-center">
                  <span>Pending WO</span>
                  <span className="ml-2 text-xs font-bold">
                      {counts.sr.pending}
                  </span>
              </div>
          ),
          value: "choose-vendor",
      },
      {
          label: (
              <div className="flex items-center">
                  <span>Approved WO</span>
                  <span className="ml-2 rounded text-xs font-bold">
                      {counts.sr.approved}
                  </span>
              </div>
          ),
          value: "approved-sr",
      },
  ], [role, counts]);

  // --- Tab Change Handler ---
    const handleTabClick = useCallback((value: string) => {
        if (tab !== value) {
            setTab(value);
            // The useEffect for tab will update the URL
        }
    }, [tab]);

  return (
    <div className="flex-1 space-y-4">
        <div className="flex items-center max-sm:items-start gap-4 max-sm:flex-col">
            {adminTabs && (
                <Radio.Group
                    options={adminTabs}
                    optionType="button"
                    buttonStyle="solid"
                    value={tab}
                    onChange={(e) => handleTabClick(e.target.value)}
                />
            )}
          {items && (
              <Radio.Group
                  options={items}
                  optionType="button"
                  buttonStyle="solid"
                  value={tab}
                  onChange={(e) => handleTabClick(e.target.value)}
              />
          )}
        </div>

         <Suspense fallback={
            <LoadingFallback />
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