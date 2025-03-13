import { useUserData } from "@/hooks/useUserData";
import { useDocCountStore } from "@/zustand/useDocCountStore";
import { Radio } from "antd";
import React, { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ApproveSelectAmendSR } from "./service-request/approve-amend-sr-list";
import { ApproveSelectSR } from "./service-request/approve-service-request-list";
import { ApprovedSRList } from "./service-request/approved-sr-list";
import { SelectServiceVendorList } from "./service-request/select-service-vendor-list";

export const ServiceRequestsTabs : React.FC = () => {
    const [searchParams] = useSearchParams();

    const {role, user_id} = useUserData();

    const [tab, setTab] = useState<string>(searchParams.get("tab") || ((["Nirmaan Admin Profile", "Nirmaan Project Lead Profile"].includes(role) || user_id === "Administrator") ? "approve-service-order" : "choose-vendor"));

    const {pendingSRCount, adminPendingSRCount, approvedSRCount, adminApprovedSRCount, adminAmendedSRCount, amendedSRCount, adminSelectedSRCount, selectedSRCount} = useDocCountStore()

    const adminTabs = [
        ...(["Nirmaan Admin Profile", "Nirmaan Project Lead Profile"].includes(role) || user_id === "Administrator" ? [
            {
                label: (
                    <div className="flex items-center">
                        <span>Approve Service Order</span>
                        <span className="ml-2 text-xs font-bold">
                            {(role === "Nirmaan Admin Profile" || user_id === "Administrator") ? adminSelectedSRCount : selectedSRCount}
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
                            {(role === "Nirmaan Admin Profile" || user_id === "Administrator") ? adminAmendedSRCount : amendedSRCount}
                        </span>
                    </div>
                ),
                value: "approve-amended-so",

            }
        ] : []),
    ]

    const items = [
        {
          label: (
              <div className="flex items-center">
                  <span>In Progress SR</span>
                  <span className="ml-2 text-xs font-bold">
                      {(role === "Nirmaan Admin Profile" || user_id === "Administrator") ? adminPendingSRCount : pendingSRCount}
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
                      {(role === "Nirmaan Admin Profile" || user_id === "Administrator") ? adminApprovedSRCount : approvedSRCount}
                  </span>
              </div>
          ),
          value: "approved-sr",
      },
  ];

  const updateURL = (key, value) => {
      const url = new URL(window.location);
      url.searchParams.set(key, value);
      window.history.pushState({}, "", url);
  };

  const onClick = (value) => {
      if (tab === value) return; // Prevent redundant updates

      const newTab = value;
      setTab(newTab);
      updateURL("tab", newTab);
  };

  return (
    <div className="flex-1 space-y-4">
        <div className="flex items-center max-sm:items-start gap-4 max-sm:flex-col">
            {adminTabs && (
                <Radio.Group
                    block
                    options={adminTabs}
                    optionType="button"
                    buttonStyle="solid"
                    value={tab}
                    onChange={(e) => onClick(e.target.value)}
                />
            )}
          {items && (
              <Radio.Group
                  block
                  options={items}
                  optionType="button"
                  buttonStyle="solid"
                  value={tab}
                  onChange={(e) => onClick(e.target.value)}
              />
          )}
        </div>

          {tab === "choose-vendor" ? (
            <SelectServiceVendorList />
          ) : tab === "approve-service-order" ? (
            <ApproveSelectSR />
          ) : tab === "approve-amended-so" ? (
            <ApproveSelectAmendSR /> 
          ) : (
            <ApprovedSRList />
          )}
      </div>
  )
}