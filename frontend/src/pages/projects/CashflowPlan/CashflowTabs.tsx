import { cn } from "@/lib/utils";

export const CASHFLOW_TABS = {
    PO_CASHFLOW: "PO Cashflow",
    WO_CASHFLOW: "WO Cashflow",
    INFLOW: "Inflow",
    MISC_CASHFLOW: "Misc. Cashflow",
} as const;

export type CashflowTabValue = typeof CASHFLOW_TABS[keyof typeof CASHFLOW_TABS];

interface CashflowTabsProps {
    activeTab: CashflowTabValue;
    onTabChange: (tab: CashflowTabValue) => void;
    badges?: Record<string, string | number>; // Optional counts/amounts e.g. { "PO Cashflow": "₹12.5L" }
    rightElement?: React.ReactNode;
}

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const CASHFLOW_TAB_CONFIG = [
    { value: CASHFLOW_TABS.PO_CASHFLOW, label: "PO Cashflow", color: "text-blue-600 bg-blue-50", hover: "hover:bg-blue-50 hover:text-blue-700", border: "border-blue-200" },
    { value: CASHFLOW_TABS.WO_CASHFLOW, label: "WO Cashflow", color: "text-orange-600 bg-orange-50", hover: "hover:bg-orange-50 hover:text-orange-700", border: "border-orange-200" },
    { value: CASHFLOW_TABS.INFLOW,      label: "Inflow",      color: "text-green-600 bg-green-50", hover: "hover:bg-green-50 hover:text-green-700", border: "border-green-200" },
    { value: CASHFLOW_TABS.MISC_CASHFLOW, label: "Misc. Cashflow", color: "text-purple-600 bg-purple-50", hover: "hover:bg-purple-50 hover:text-purple-700", border: "border-purple-200" },
] as const;

export const CashflowTabs = ({ activeTab, onTabChange, badges, rightElement }: CashflowTabsProps) => {

    return (
        <div className="bg-white border-b border-gray-100">
            {/* Mobile View: Dropdown & Action Row */}
            <div className="block md:hidden p-2">
                <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                        <Select value={activeTab} onValueChange={(val) => onTabChange(val as CashflowTabValue)}>
                            <SelectTrigger className="w-full h-9 text-xs font-medium truncate">
                                <SelectValue placeholder="Select View" />
                            </SelectTrigger>
                            <SelectContent>
                                {CASHFLOW_TAB_CONFIG.map((tab) => (
                                    <SelectItem key={tab.value} value={tab.value} className="text-xs">
                                        <span className={cn("flex items-center gap-2", activeTab === tab.value && "font-bold")}>
                                            {tab.label}
                                            {badges?.[tab.value] && (
                                                <span className="text-[10px] text-gray-500 ml-auto">({badges[tab.value]})</span>
                                            )}
                                        </span>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    
                    {rightElement && (
                        <div className="shrink-0">
                            {rightElement}
                        </div>
                    )}
                </div>
            </div>

            {/* Desktop View: Tabs */}
            <div className="hidden md:flex px-2 pt-1 gap-1 w-full overflow-x-auto no-scrollbar items-center">
                {CASHFLOW_TAB_CONFIG.map((tab) => {
                    const isActive = activeTab === tab.value;
                    const badgeVal = badges?.[tab.value];

                    return (
                        <button
                            key={tab.value}
                            onClick={() => onTabChange(tab.value)}
                            className={cn(
                                "group relative flex items-center gap-2 px-3 py-2.5 text-xs font-medium transition-all rounded-t-md border-b-2 border-transparent select-none",
                                isActive 
                                    ? `text-gray-900 ${tab.color.split(" ")[0]} border-current bg-gray-50/50` 
                                    : "text-gray-500 hover:text-gray-700 hover:bg-gray-50",
                            )}
                        >
                            <span className={cn(isActive && "font-bold")}>{tab.label}</span>
                            
                            {badgeVal !== undefined && (
                                <span className={cn(
                                    "px-1.5 py-0.5 rounded text-[10px] font-bold tracking-tight",
                                    isActive ? tab.color : "bg-gray-100 text-gray-500 group-hover:bg-gray-200"
                                )}>
                                    {badgeVal}
                                </span>
                            )}
                            
                            {/* Accent Line for Active State optimization */}
                            {isActive && (
                                <div className="absolute bottom-[-2px] left-0 right-0 h-[2px] bg-current" />
                            )}
                        </button>
                    );
                })}
                {rightElement && (
                    <div className="ml-auto flex items-center pr-2 pb-1">
                        {rightElement}
                    </div>
                )}
            </div>
        </div>
    );
};
