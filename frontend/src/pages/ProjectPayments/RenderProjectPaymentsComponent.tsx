import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { getUrlStringParam } from "@/hooks/useServerDataTable";
import { useUserData } from "@/hooks/useUserData";
import { parseNumber } from "@/utils/parseNumber";
import { urlStateManager } from "@/utils/urlStateManager";
import { useDocCountStore } from "@/zustand/useDocCountStore";
import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";
// --- Tab Configuration ---
import {
    PP_TABS,PP_ADMIN_TAB_OPTIONS,PP_NEW_PAYMENTS_TAB_OPTIONS,PP_REM_TAB_OPTIONS,PP_ALL_TAB_OPTIONS,PP_ADMIN_ROLES,PP_ACCOUNTANT_ROLES,PP_PROJECT_ROLES,PPTabOption,
} from "./config/ppTabs.constants";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info } from "lucide-react";

const ApprovePayments = React.lazy(() => import("./approve-payments/ApprovePayments"));
const AccountantTabs = React.lazy(() => import("./update-payment/AccountantTabs"));
const ProjectPaymentsList = React.lazy(() => import("./project-payments-list"));
const AllPayments = React.lazy(() => import("./AllPayments"));
const PaymentSummaryCards = React.lazy(() => import("./PaymentSummaryCards"));

export const RenderProjectPaymentsComponent: React.FC = () => {

    const { role, user_id } = useUserData();

    const { counts } = useDocCountStore()

    const canApprovePayments = user_id === "Administrator" || role === "Nirmaan Admin Profile";

    // --- Tab State Management ---
    const isAdmin = useMemo(() => PP_ADMIN_ROLES.includes(role), [role]);
    const isAccountant = useMemo(() => PP_ACCOUNTANT_ROLES.includes(role), [role]);
    const isProjectRole = useMemo(() => PP_PROJECT_ROLES.includes(role), [role]);

    const initialTab = useMemo(() => {
        const adminDefault = PP_TABS.APPROVE_PAYMENTS;
        const accountantDefault = PP_TABS.NEW_PAYMENTS;
        const userDefault = PP_TABS.PAYMENTS_DONE;
        const remDefault = PP_TABS.PO_WISE;
        return getUrlStringParam("tab", isAdmin ? adminDefault : isAccountant ? accountantDefault : isProjectRole ? userDefault : remDefault);
    }, [isAdmin, isAccountant, isProjectRole]); // Calculate only once based on role

    const [tab, setTab] = useState<string>(initialTab);

    // Effect to sync tab state TO URL
    useEffect(() => {
        // Only update URL if the state `tab` is different from the URL's current 'tab' param
        if (urlStateManager.getParam("tab") !== tab) {
            urlStateManager.updateParam("tab", tab);
        }
    }, [tab]);

    // Effect to sync URL state TO tab state (for popstate/direct URL load)
    useEffect(() => {
        const unsubscribe = urlStateManager.subscribe("tab", (_, value) => {
            // Update state only if the new URL value is different from current state
            const newTab = value || initialTab; // Fallback to initial if param removed
            if (tab !== newTab) {
                setTab(newTab);
            }
        });
        return unsubscribe; // Cleanup subscription
    }, [initialTab]); // Depend on `tab` to avoid stale closures

    // const [tab, setTab] = useStateSyncedWithParams<string>("tab", (role === "Nirmaan Admin Profile" ? "Approve Payments" : role === "Nirmaan Accountant Profile" ?  "New Payments" : ["Nirmaan Procurement Executive Profile", "Nirmaan Project Lead Profile", "Nirmaan Project Manager Profile"].includes(role) ? "Payments Done" : "PO Wise"))

    // --- Tab Change Handler ---
    const handleTabClick = useCallback((value: string) => {
        if (tab !== value) {
            setTab(value);
        }
    }, [tab]);

    // --- Filter tabs based on role ---
    const adminTabsFiltered = useMemo(() => PP_ADMIN_TAB_OPTIONS, []);
    const newPaymentsTabsFiltered = useMemo(() => (isAdmin || isAccountant) ? PP_NEW_PAYMENTS_TAB_OPTIONS : [], [isAdmin, isAccountant]);
    const remTabsFiltered = useMemo(() => (isAdmin || isAccountant) ? PP_REM_TAB_OPTIONS : [], [isAdmin, isAccountant]);
    const paymentTypeTabsFiltered = useMemo(() => [
        {
            label: "Payments Done",
            value: PP_TABS.PAYMENTS_DONE,
            countValue: counts.pay.paid
        },
        {
            label: "Payments Pending",
            value: PP_TABS.PAYMENTS_PENDING,
            countValue: parseNumber(counts.pay.requested) + parseNumber(counts.pay.approved)
        }
    ], [counts]);

    // Render a single tab button
    const renderTabButton = (option: PPTabOption | { label: string, value: string, countValue: number | string }) => {
        // Resolve count either straight from passed value or via dot notation from countKey
        const count = 'countValue' in option && option.countValue !== undefined
            ? option.countValue
            : ('countKey' in option && option.countKey)
                ? option.countKey.split('.').reduce((acc: any, part: string) => acc && acc[part], counts) ?? 0
                : null;
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
                {count !== null && count !== undefined && (
                    <span className={`text-xs font-bold ${isActive ? "opacity-90" : "opacity-70"}`}>
                        {count}
                    </span>
                )}
            </button>
        );
    };

    return (
        <div className="flex-1 space-y-4">
            {/* <PaymentSummaryCards/> */}

            {/* Tab Navigation - Custom Tailwind buttons */}
            <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 scrollbar-thin">
                <div className="flex flex-nowrap sm:flex-wrap items-center gap-1.5 pb-1 sm:pb-0">
                    {/* Admin Tabs */}
                    {adminTabsFiltered.length > 0 && (
                        <>
                            {adminTabsFiltered.map(renderTabButton)}
                            {/* Separator */}
                            <div className="w-px h-5 sm:h-6 bg-gray-300 mx-0.5 sm:mx-1 shrink-0" />
                        </>
                    )}
                    {/* New Payments Tab */}
                    {newPaymentsTabsFiltered.length > 0 && (
                        <>
                            {newPaymentsTabsFiltered.map(renderTabButton)}
                            <div className="w-px h-5 sm:h-6 bg-gray-300 mx-0.5 sm:mx-1 shrink-0" />
                        </>
                    )}
                    {/* Rem (PO Wise) Tab */}
                    {remTabsFiltered.length > 0 && (
                        <>
                            {remTabsFiltered.map(renderTabButton)}
                            <div className="w-px h-5 sm:h-6 bg-gray-300 mx-0.5 sm:mx-1 shrink-0" />
                        </>
                    )}
                    {/* Payment Type Tabs */}
                    {paymentTypeTabsFiltered.length > 0 && (
                        <>
                            {paymentTypeTabsFiltered.map(renderTabButton)}
                            <div className="w-px h-5 sm:h-6 bg-gray-300 mx-0.5 sm:mx-1 shrink-0" />
                        </>
                    )}
                    {/* All Payments Tab */}
                    {PP_ALL_TAB_OPTIONS.map(renderTabButton)}
                </div>
            </div>
            <Suspense fallback={
                <LoadingFallback />
            }>
                {tab === PP_TABS.APPROVE_PAYMENTS ? (
                    <>
                        {!canApprovePayments && (
                            <Alert variant="default" className="border-blue-200 bg-blue-50 mb-4">
                                <Info className="h-4 w-4 text-blue-600" />
                                <AlertDescription className="text-sm text-blue-800">
                                    These payments are pending approval from an admin. Contact an admin for urgent cases.
                                </AlertDescription>
                            </Alert>
                        )}
                        <ApprovePayments readOnly={!canApprovePayments} />
                    </>
                ) :

                    [PP_TABS.NEW_PAYMENTS].includes(tab as any) ?
                        (
                            <AccountantTabs />
                        ) : [PP_TABS.PAYMENTS_PENDING, PP_TABS.PAYMENTS_DONE, PP_TABS.ALL_PAYMENTS].includes(tab as any) ? (
                            <AllPayments tab={tab} />
                        )
                            : (
                                <ProjectPaymentsList />
                            )}
            </Suspense>
        </div>
    );
};