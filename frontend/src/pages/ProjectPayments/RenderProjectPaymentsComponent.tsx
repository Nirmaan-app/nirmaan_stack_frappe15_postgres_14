import { useUserData } from "@/hooks/useUserData";
import { parseNumber } from "@/utils/parseNumber";
import { useDocCountStore } from "@/zustand/useDocCountStore";
import { Radio } from "antd";
import React, { Suspense, useCallback, useMemo, useState } from "react";
import { TailSpin } from "react-loader-spinner";
import { useSearchParams } from "react-router-dom";

const ApprovePayments = React.lazy(() => import("./approve-payments"));
const AccountantTabs = React.lazy(() => import("./AccountantTabs"));
const ProjectPaymentsList = React.lazy(() => import("./project-payments-list"));
const AllPayments = React.lazy(() => import("./AllPayments"));

export const RenderProjectPaymentsComponent: React.FC = () => {

    const [searchParams] = useSearchParams();

    const {role} = useUserData();

    const {paymentsCount, adminPaymentsCount} = useDocCountStore()

    const [tab, setTab] = useState<string>(searchParams.get("tab") || (role === "Nirmaan Admin Profile" ? "Approve Payments" : role === "Nirmaan Accountant Profile" ?  "New Payments" : ["Nirmaan Procurement Executive Profile", "Nirmaan Project Lead Profile", "Nirmaan Project Manager Profile"].includes(role) ? "Payments Done" : "PO Wise"));

    const updateURL = useCallback((params: Record<string, string>) => {
        const url = new URL(window.location.href);
        Object.entries(params).forEach(([key, value]) => {
          url.searchParams.set(key, value);
        });
        window.history.pushState({}, '', url);
    }, []);

    const onClick = useCallback(
        (value : string) => {
        if (tab === value) return; // Prevent redundant updates

        setTab(value);
        updateURL({ tab: value });
    }, [tab, updateURL]);

    const adminTabs = useMemo(() => [
        ...(["Nirmaan Admin Profile"].includes(role) ? [
            {
                label: (
                    <div className="flex items-center">
                        <span>Approve Payments</span>
                        <span className="ml-2 text-xs font-bold">
                            {role === "Nirmaan Admin Profile" ? adminPaymentsCount?.requested : paymentsCount?.requested}
                        </span>
                    </div>
                ),
                value: "Approve Payments",
            },
        ] : [])
    ], [role, adminPaymentsCount, paymentsCount])

    const items = useMemo(() => [
        ...(["Nirmaan Admin Profile", "Nirmaan Accountant Profile"].includes(role) ? [
            {
                label: (
                    <div className="flex items-center">
                        <span>New Payments</span>
                        <span className="ml-2 text-xs font-bold">
                            {role === "Nirmaan Admin Profile" ? adminPaymentsCount?.approved : paymentsCount?.approved}
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
    ], [role, adminPaymentsCount, paymentsCount])

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
                        {role === "Nirmaan Admin Profile" ? adminPaymentsCount?.paid : paymentsCount?.paid}
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
                        {role === "Nirmaan Admin Profile" ? parseNumber(adminPaymentsCount?.requested) + parseNumber(adminPaymentsCount.approved) : parseNumber(paymentsCount?.requested) + parseNumber(paymentsCount?.approved)}
                    </span>
                </div>
            ),
            value: "Payments Pending",
        },
    ], [adminPaymentsCount, paymentsCount, role])

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
                        defaultValue="New Payments"
                        optionType="button"
                        buttonStyle="solid"
                        value={tab}
                        onChange={(e) => onClick(e.target.value)}
                    />
                )}
                <Radio.Group
                    options={remTabs}
                    optionType="button"
                    buttonStyle="solid"
                    value={tab}
                    onChange={(e) => onClick(e.target.value)}
                />

                {paymentTypeBasedTabs && (
                    <Radio.Group
                        options={paymentTypeBasedTabs}
                        defaultValue="Pending Payments"
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
                {tab === "Approve Payments" ? (
                <ApprovePayments />
                ) :
                
                ["New Payments"].includes(tab) ? 
                (
                    <AccountantTabs tab={tab} />
                ) : ["Payments Pending", "Payments Done"].includes(tab) ? (
                    <AllPayments tab={tab} />
                )
                 : (
                    <ProjectPaymentsList />
                )}
            </Suspense>
        </div>
    );
};