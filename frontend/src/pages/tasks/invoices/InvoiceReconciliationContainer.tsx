// import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"; // Use shadcn Tabs
import { INVOICE_TASK_TABS } from './constants';
import { useStateSyncedWithParams } from '@/hooks/useSearchParamsManager';
import React, { Suspense, useCallback, useMemo } from "react";
import { useUserData } from "@/hooks/useUserData";
import { Radio } from "antd";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";

const TaskHistoryTable = React.lazy(() => import('./components/TaskHistoryTable'));
const PendingTasksTable = React.lazy(() => import('./components/PendingTasksTable'));

export default function InvoiceReconciliationContainer() {
    // Use your hook to sync tab state with URL param 'tab'
    const {role} = useUserData();
    const [activeTab, setActiveTab] = useStateSyncedWithParams<string>(
        "tab",
        INVOICE_TASK_TABS.PENDING // Default to pending tab
    );

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
                if (activeTab === value) return; // Prevent redundant updates
        
                setActiveTab(value);
            }, [activeTab]);

        // <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        //         <TabsList className="grid w-full grid-cols-2 max-w-md">
        //             <TabsTrigger value={INVOICE_TASK_TABS.PENDING}>
        //                 Pending Tasks
        //                 {/* Optional: Add count here if needed later */}
        //             </TabsTrigger>
        //             <TabsTrigger value={INVOICE_TASK_TABS.HISTORY}>
        //                 Task History
        //             </TabsTrigger>
        //         </TabsList>

        //         {/* Content for Pending Tasks */}
        //         <TabsContent value={INVOICE_TASK_TABS.PENDING} className="mt-4">
        //             <PendingTasksTable />
        //         </TabsContent>

        //         {/* Content for Task History */}
        //         <TabsContent value={INVOICE_TASK_TABS.HISTORY} className="mt-4">
        //             <TaskHistoryTable />
        //         </TabsContent>
        //     </Tabs>

    return (
        <div 
        // className="container mx-auto p-4 space-y-6"
        className="flex-1 space-y-4"
        >
                {tabs && (
                    <Radio.Group
                        options={tabs}
                        defaultValue="pending"
                        optionType="button"
                        buttonStyle="solid"
                        value={activeTab}
                        onChange={(e) => onClick(e.target.value)}
                    />
                )}

                <Suspense fallback={
                              <LoadingFallback />
                          }>
                              {activeTab === "pending" ? (
                              <PendingTasksTable />
                              ) : (
                                  <TaskHistoryTable />
                              )}
                          </Suspense>

        </div>
    );
}