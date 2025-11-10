import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { getUrlStringParam } from "@/hooks/useServerDataTable";
import { useUserData } from "@/hooks/useUserData";
import { parseNumber } from "@/utils/parseNumber";
import { urlStateManager } from "@/utils/urlStateManager";
import { useDocCountStore } from "@/zustand/useDocCountStore";
import { Radio } from "antd";
import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";


const ApprovePayments = React.lazy(() => import("./approve-payments/ApprovePayments"));
const AccountantTabs = React.lazy(() => import("./update-payment/AccountantTabs"));
const ProjectPaymentsList = React.lazy(() => import("./project-payments-list"));
const AllPayments = React.lazy(() => import("./AllPayments"));
const PaymentSummaryCards = React.lazy(() => import("./PaymentSummaryCards"));

export const RenderProjectPaymentsComponent: React.FC = () => {

    const {role} = useUserData();

    const {counts} = useDocCountStore()

    // --- Tab State Management ---
    const initialTab = useMemo(() => {
        const adminDefault = "Approve Payments";
        const accountantDefault = "New Payments";
        const userDefault = "Payments Done";
        const remDefault = "PO Wise";
        return getUrlStringParam("tab", role === "Nirmaan Admin Profile" ? adminDefault : role === "Nirmaan Accountant Profile" ?  accountantDefault : ["Nirmaan Procurement Executive Profile", "Nirmaan Project Lead Profile", "Nirmaan Project Manager Profile"].includes(role) ? userDefault : remDefault);
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

    // const [tab, setTab] = useStateSyncedWithParams<string>("tab", (role === "Nirmaan Admin Profile" ? "Approve Payments" : role === "Nirmaan Accountant Profile" ?  "New Payments" : ["Nirmaan Procurement Executive Profile", "Nirmaan Project Lead Profile", "Nirmaan Project Manager Profile"].includes(role) ? "Payments Done" : "PO Wise"))

    // --- Tab Change Handler ---
    const handleTabClick = useCallback((value: string) => {
        if (tab !== value) {
            setTab(value);
        }
    }, [tab]);

    const adminTabs = useMemo(() => [
        ...(["Nirmaan Admin Profile"].includes(role) ? [
            {
                label: (
                    <div className="flex items-center">
                        <span>Approve Payments</span>
                        <span className="ml-2 text-xs font-bold">
                            {counts.pay.requested}
                        </span>
                    </div>
                ),
                value: "Approve Payments",
            },
        ] : [])
    ], [role, counts])

    const items = useMemo(() => [
        ...(["Nirmaan Admin Profile", "Nirmaan Accountant Profile"].includes(role) ? [
            {
                label: (
                    <div className="flex items-center">
                        <span>New Payments</span>
                        <span className="ml-2 text-xs font-bold">
                            {counts.pay.approved}
                        </span>
                    </div>
                ),
                value: "New Payments",
            },
            // {
            //     label: (
            //         <div className="flex items-center">
            //             <span>Fulfilled Payments</span>
            //             <span className="ml-2 rounded text-xs font-bold">
            //                 {role === "Nirmaan Admin Profile" ? adminPaymentsCount?.paid : paymentsCount?.paid}
            //             </span>
            //         </div>
            //     ),
            //     value: "Fulfilled Payments",
            // },
        ] : [])
    ], [role, counts])
        
    const allTab = useMemo(() => 
            [
                { label: (<div className="flex items-center"><span>All Payments</span><span className="ml-2 text-xs font-bold">{counts.pay.all}</span></div>), value: "All Payments" },
            ]
        ,[counts, role])

    const remTabs = useMemo(() => [
        ...(["Nirmaan Admin Profile", "Nirmaan Accountant Profile"].includes(role) ? ["PO Wise"] : []),
        // "All Payments"
    ], [role])

    const paymentTypeBasedTabs = useMemo(() => [
        {
            label: (
                <div className="flex items-center">
                    <span>Payments Done</span>
                    <span className="ml-2 rounded text-xs font-bold">
                        {counts.pay.paid}
                    </span>
                </div>
            ),
            value: "Payments Done",
        },
        {
            label: (
                <div className="flex items-center">
                    <span>Payments Pending</span>
                    <span className="ml-2 text-xs font-bold">
                        {parseNumber(counts.pay.requested) + parseNumber(counts.pay.approved)}
                    </span>
                </div>
            ),
            value: "Payments Pending",
        },
    ], [counts, role])



    return (
        <div className="flex-1 space-y-4">
                {/* <PaymentSummaryCards/> */}

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
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
                        defaultValue="New Payments"
                        optionType="button"
                        buttonStyle="solid"
                        value={tab}
                        onChange={(e) => handleTabClick(e.target.value)}
                    />
                )}
                <Radio.Group
                    options={remTabs}
                    optionType="button"
                    buttonStyle="solid"
                    value={tab}
                    onChange={(e) => handleTabClick(e.target.value)}
                />

                {paymentTypeBasedTabs && (
                    <Radio.Group
                        options={paymentTypeBasedTabs}
                        defaultValue="Pending Payments"
                        optionType="button"
                        buttonStyle="solid"
                        value={tab}
                        onChange={(e) => handleTabClick(e.target.value)}
                    />
                )}

                {allTab && (
                    <Radio.Group
                        options={allTab}
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
                {tab === "Approve Payments" ? (
                <ApprovePayments />
                ) :
                
                ["New Payments"].includes(tab) ? 
                (
                    <AccountantTabs />
                ) : ["Payments Pending", "Payments Done", "All Payments"].includes(tab) ? (
                    <AllPayments tab={tab} />
                )
                 : (
                    <ProjectPaymentsList />
                )}
            </Suspense>
        </div>
    );
};