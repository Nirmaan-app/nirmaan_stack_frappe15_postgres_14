// import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"; // Use shadcn Tabs
import { INVOICE_TASK_TABS } from './constants';
import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useUserData } from "@/hooks/useUserData";
import { Radio } from "antd";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { getUrlStringParam } from '@/hooks/useServerDataTable';
import { urlStateManager } from '@/utils/urlStateManager';

const TaskHistoryTable = React.lazy(() => import('./components/TaskHistoryTable'));
const PendingTasksTable = React.lazy(() => import('./components/PendingTasksTable'));

export default function InvoiceReconciliationContainer() {
    // Use your hook to sync tab state with URL param 'tab'
    const {role} = useUserData();

    // --- Tab State Management ---
    const initialTab = useMemo(() => {
        // Determine initial tab based on role, default to "Approved PO" if not admin/lead
        const defaultTab = ["Nirmaan Admin Profile", "Nirmaan Accountant Profile"].includes(role) ? INVOICE_TASK_TABS.PENDING : INVOICE_TASK_TABS.HISTORY;
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
    }, [tab, initialTab]); // Depend on `tab` to avoid stale closures


    const tabs = useMemo(() => [
            ...(["Nirmaan Admin Profile", "Nirmaan Accountant Profile"].includes(role) ? [
                {
                    label: (
                        <div className="flex items-center">
                            <span>Pending Tasks</span>
                            {/* <span className="ml-2 text-xs font-bold">
                                {role === "Nirmaan Admin Profile" ? adminPaymentsCount?.requested : paymentsCount?.requested}
                            </span> */}
                        </div>
                    ),
                    value: INVOICE_TASK_TABS.PENDING,
                },
            ] : []),
            {
              label: (
                  <div className="flex items-center">
                      <span>Task History</span>
                      {/* <span className="ml-2 text-xs font-bold">
                          {role === "Nirmaan Admin Profile" ? adminPaymentsCount?.requested : paymentsCount?.requested}
                      </span> */}
                  </div>
              ),
              value: INVOICE_TASK_TABS.HISTORY,
          },
        ], [role])

    const onClick = useCallback(
            (value : string) => {
            if (tab === value) return; // Prevent redundant updates
    
            setTab(value);
        }, [tab]);

    return (
        <div 
        className="flex-1 space-y-4"
        >
                {tabs && (
                    <Radio.Group
                        options={tabs}
                        defaultValue="pending"
                        optionType="button"
                        buttonStyle="solid"
                        value={tab}
                        onChange={(e) => onClick(e.target.value)}
                    />
                )}

                <Suspense fallback={
                    <LoadingFallback />
                }>
                    {tab === "pending" ? (
                    <PendingTasksTable />
                    ) : (
                        <TaskHistoryTable />
                    )}
                </Suspense>

        </div>
    );
}