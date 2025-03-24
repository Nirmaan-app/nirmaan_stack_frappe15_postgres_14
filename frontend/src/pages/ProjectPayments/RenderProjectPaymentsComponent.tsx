import { useUserData } from "@/hooks/useUserData";
import { useDocCountStore } from "@/zustand/useDocCountStore";
import { Radio } from "antd";
import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AccountantTabs } from "./AccountantTabs";
import { ApprovePayments } from "./approve-payments";
import { ProjectPaymentsList } from "./project-payments-list";

export const RenderProjectPaymentsComponent = () => {

    const [searchParams] = useSearchParams();

    const {role} = useUserData();

    const {paymentsCount, adminPaymentsCount} = useDocCountStore()

    const [tab, setTab] = useState<string>(searchParams.get("tab") || (role === "Nirmaan Admin Profile" ? "Approve Payments" : role === "Nirmaan Accountant Profile" ?  "New Payments" : "All Payments"));

    

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
            {
                label: (
                    <div className="flex items-center">
                        <span>Fulfilled Payments</span>
                        <span className="ml-2 rounded text-xs font-bold">
                            {role === "Nirmaan Admin Profile" ? adminPaymentsCount?.paid : paymentsCount?.paid}
                        </span>
                    </div>
                ),
                value: "Fulfilled Payments",
            },
        ] : [])
    ], [role, adminPaymentsCount, paymentsCount])

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
                    options={[...(["Nirmaan Admin Profile", "Nirmaan Accountant Profile"].includes(role) ? ["PO Wise"] : []), "All Payments"]}
                    optionType="button"
                    buttonStyle="solid"
                    value={tab}
                    onChange={(e) => onClick(e.target.value)}
                />
            </div>
            {tab === "Approve Payments" ? (
                <ApprovePayments />
            ) :
            
            ["New Payments", "Fulfilled Payments"].includes(tab) ? 
            (
                <AccountantTabs tab={tab} />
            )
             : (
                <ProjectPaymentsList tab={tab} />
            )}
        </div>
    );
};