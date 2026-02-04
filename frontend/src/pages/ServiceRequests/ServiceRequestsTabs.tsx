import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { getUrlStringParam } from "@/hooks/useServerDataTable";
import { useUserData } from "@/hooks/useUserData";
import { urlStateManager } from "@/utils/urlStateManager";
import { useDocCountStore } from "@/zustand/useDocCountStore";
import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import {
    SR_TABS,
    SR_ADMIN_TAB_OPTIONS,
    SR_COMMON_TAB_OPTIONS,
    SR_ADMIN_ROLES,
    SRTabOption,
} from "./config/srTabs.constants";
import { NewWODialog } from "./components/NewWODialog";

const ApproveSelectSR = React.lazy(() => import("./service-request/approve-service-request-list"));
const ApproveSelectAmendSR = React.lazy(() => import("./service-request/approve-amend-sr-list"));
const SelectServiceVendorList = React.lazy(() => import("./service-request/select-service-vendor-list"));
const ApprovedSRList = React.lazy(() => import("./service-request/approved-sr-list"));
const FinalizedSRList = React.lazy(() => import("./service-request/finalized-sr-list"));

export const ServiceRequestsTabs: React.FC = () => {
    const { role } = useUserData();
    const { counts } = useDocCountStore();

    const isAdmin = useMemo(() => SR_ADMIN_ROLES.includes(role), [role]);

    // --- Tab State Management using urlStateManager ---
    const initialTab = useMemo(() => {
        const adminDefault = SR_TABS.APPROVE_WO;
        const userDefault = SR_TABS.PENDING;
        return getUrlStringParam("tab", isAdmin ? adminDefault : userDefault);
    }, [isAdmin]);

    const [tab, setTab] = useState<string>(initialTab);

    useEffect(() => {
        if (urlStateManager.getParam("tab") !== tab) {
            urlStateManager.updateParam("tab", tab);
        }
    }, [tab]);

    useEffect(() => {
        const unsubscribe = urlStateManager.subscribe("tab", (_, value) => {
            const newTab = value || initialTab;
            if (tab !== newTab) setTab(newTab);
        });
        return unsubscribe;
    }, [initialTab, tab]);

    // Filter admin tabs based on role
    const adminTabs = useMemo(() => {
        return isAdmin ? SR_ADMIN_TAB_OPTIONS : [];
    }, [isAdmin]);

    // --- Tab Change Handler ---
    const handleTabClick = useCallback((value: string) => {
        if (tab !== value) {
            setTab(value);
        }
    }, [tab]);

    // Render a single tab button
    const renderTabButton = (option: SRTabOption) => {
        const count = counts.sr[option.countKey] ?? 0;
        const isActive = tab === option.value;

        return (
            <button
                key={option.value}
                type="button"
                onClick={() => handleTabClick(option.value)}
                className={`px-2.5 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm rounded
                    transition-colors flex items-center gap-1.5 whitespace-nowrap
                    ${isActive
                        ? "bg-sky-500 text-white"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}
            >
                {option.label}
                <span className={`text-xs font-bold ${isActive ? "opacity-90" : "opacity-70"}`}>
                    {count}
                </span>
            </button>
        );
    };

    return (
        <div className="flex-1 space-y-4">
            {/* Tab Navigation - Custom Tailwind buttons */}
            <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 scrollbar-thin">
                <div className="flex gap-1.5 sm:flex-wrap pb-1 sm:pb-0">
                    {/* Admin Tabs */}
                    {adminTabs.length > 0 && (
                        <>
                            {adminTabs.map(renderTabButton)}
                            {/* Separator between admin and common tabs */}
                            <div className="w-px bg-gray-300 mx-1 self-stretch" />
                        </>
                    )}

                    {/* Common Tabs */}
                    {SR_COMMON_TAB_OPTIONS.map(renderTabButton)}
                </div>
            </div>

            {/* Tab Content */}
            <Suspense fallback={<LoadingFallback />}>
                {tab === SR_TABS.APPROVE_WO && <ApproveSelectSR />}
                {tab === SR_TABS.APPROVE_AMENDED && <ApproveSelectAmendSR />}
                {tab === SR_TABS.PENDING && <SelectServiceVendorList />}
                {tab === SR_TABS.APPROVED && <ApprovedSRList />}
                {tab === SR_TABS.FINALIZED && <FinalizedSRList />}
            </Suspense>

            {/* New Work Order Dialog */}
            <NewWODialog />
        </div>
    );
};
