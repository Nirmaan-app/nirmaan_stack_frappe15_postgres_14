import React from "react";
import { cn } from "@/lib/utils";

export const CASHFLOW_TABS = {
    PO_CASHFLOW: "PO Cashflow",
    WO_CASHFLOW: "WO Cashflow",
    MISC_CASHFLOW: "Misc. Cashflow",
    INFLOW: "Inflow",
} as const;

export type CashflowTabValue = typeof CASHFLOW_TABS[keyof typeof CASHFLOW_TABS];

interface CashflowTabsProps {
    activeTab: CashflowTabValue;
    onTabChange: (tab: CashflowTabValue) => void;
    rightContent?: React.ReactNode;
}

export const CashflowTabs = ({ activeTab, onTabChange, rightContent }: CashflowTabsProps) => {
    return (
        <div className="flex border-b border-gray-200 mb-4 justify-between items-center">
            <div className="flex overflow-x-auto">
                {Object.values(CASHFLOW_TABS).map((tab) => (
                    <button
                        key={tab}
                        onClick={() => onTabChange(tab)}
                        className={cn(
                            "px-4 py-2 text-sm font-medium transition-colors border-b-2 whitespace-nowrap -mb-[1px]",
                            activeTab === tab
                                ? "border-blue-600 text-blue-600"
                                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                        )}
                    >
                        {tab}
                    </button>
                ))}
            </div>
            {rightContent && <div className="pl-4 pb-2">{rightContent}</div>}
        </div>
    );
};
