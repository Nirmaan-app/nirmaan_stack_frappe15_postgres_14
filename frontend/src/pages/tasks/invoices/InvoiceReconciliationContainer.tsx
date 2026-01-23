import { INVOICE_TASK_TABS, INVOICE_TASK_TAB_OPTIONS, INVOICE_TYPE_TAB_OPTIONS } from './constants';
import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useUserData } from "@/hooks/useUserData";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { getUrlStringParam } from '@/hooks/useServerDataTable';
import { urlStateManager } from '@/utils/urlStateManager';

const TaskHistoryTable = React.lazy(() => import('./components/TaskHistoryTable'));
const PendingTasksTable = React.lazy(() => import('./components/PendingTasksTable'));
const AllPoInvocies=React.lazy(()=>import('./components/PoInvoices'))
const AllSRInvocies=React.lazy(()=>import('./components/SrInvoices'))


export default function InvoiceReconciliationContainer() {
    // Use your hook to sync tab state with URL param 'tab'
    const {role} = useUserData();

    // --- Tab State Management ---
    const initialTab = useMemo(() => {
        // Determine initial tab based on role, default to "Approved PO" if not admin/lead
        const defaultTab = ["Nirmaan Admin Profile", "Nirmaan PMO Executive Profile", "Nirmaan Accountant Profile"].includes(role) ? INVOICE_TASK_TABS.PENDING : INVOICE_TASK_TABS.HISTORY;
        return getUrlStringParam("tab", defaultTab);
    }, [role]); // Calculate only once based on role
    
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


    // Filter task tabs based on role (only Admin/PMO/Accountant can see pending approvals)
    const taskTabs = useMemo(() => {
        const canViewPending = ["Nirmaan Admin Profile", "Nirmaan PMO Executive Profile", "Nirmaan Accountant Profile"].includes(role);
        return canViewPending
            ? INVOICE_TASK_TAB_OPTIONS
            : INVOICE_TASK_TAB_OPTIONS.filter(t => t.value !== INVOICE_TASK_TABS.PENDING);
    }, [role]);
         

    const onClick = useCallback(
            (value : string) => {
            if (tab === value) return; // Prevent redundant updates
    
            setTab(value);
        }, [tab]);

    return (
        <div>
            {/* Tab Navigation - Credit Payments Style */}
            <div className="pb-4">
                <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 scrollbar-thin">
                    <div className="flex gap-1.5 sm:flex-wrap pb-1 sm:pb-0">
                        {/* Task Tabs */}
                        {taskTabs.map((option) => (
                            <button
                                key={option.value}
                                type="button"
                                onClick={() => onClick(option.value)}
                                className={`px-2.5 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm rounded
                                    transition-colors flex items-center gap-1.5 whitespace-nowrap
                                    ${tab === option.value
                                        ? "bg-sky-500 text-white"
                                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                    }`}
                            >
                                {option.label}
                            </button>
                        ))}

                        {/* Separator */}
                        <div className="w-px bg-gray-300 mx-1 self-stretch" />

                        {/* Invoice Type Tabs */}
                        {INVOICE_TYPE_TAB_OPTIONS.map((option) => (
                            <button
                                key={option.value}
                                type="button"
                                onClick={() => onClick(option.value)}
                                className={`px-2.5 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm rounded
                                    transition-colors flex items-center gap-1.5 whitespace-nowrap
                                    ${tab === option.value
                                        ? "bg-sky-500 text-white"
                                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                    }`}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
                

                <Suspense fallback={
                    <LoadingFallback />
                }>
                    {tab==="history" &&(
                       <TaskHistoryTable />
                    )}
                    {tab === "pending" && (
                    <PendingTasksTable />
                    )}
                    {tab==="po_invoices" &&(
                       <AllPoInvocies />
                    )}
                    {tab==="sr_invoices" &&(
                       <AllSRInvocies />
                    )}
                </Suspense>

        </div>
    );
}