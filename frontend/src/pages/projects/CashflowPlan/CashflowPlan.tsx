import React, { useMemo } from "react";
import { useUrlParam } from "@/hooks/useUrlParam";
import { urlStateManager } from "@/utils/urlStateManager";
import { startOfDay, addDays, parseISO, format } from "date-fns";
import { DateRange } from "react-day-picker";
import { SevenDayPlanningHeader } from "../components/planning/SevenDayPlanningHeader";
import { CashflowTabs, CASHFLOW_TABS, CashflowTabValue } from "./CashflowTabs";
import { POCashflow } from "./POCashflow";
import { WOCashflow } from "./WOCashflow";
import { MiscCashflow } from "./MiscCashflow";
import { InflowCashflow } from "./InflowCashflow";

interface CashflowPlanProps {
    projectId?: string;
    isOverview?: boolean;
}

export const CashflowPlan = ({ projectId, isOverview }: CashflowPlanProps) => {
    // --- Tab State (URL) ---
    const tabParam = useUrlParam("tab");
    
    const activeTab = useMemo(() => {
        // If exact match found in values
        if (Object.values(CASHFLOW_TABS).includes(tabParam as any)) {
            return tabParam as CashflowTabValue;
        }
        return CASHFLOW_TABS.PO_CASHFLOW;
    }, [tabParam]);

    const handleTabChange = (tab: CashflowTabValue) => {
        urlStateManager.updateParam("tab", tab);
    };

    // --- Date/Duration State (Local) ---
    const activeDurationParam = useUrlParam("planningDuration");
    
    const activeDuration = useMemo(() => {
        if (activeDurationParam === "All") return "All";
        const num = Number(activeDurationParam);
        if (!isNaN(num) && [3, 7, 14].includes(num)) return num;
        if (activeDurationParam === "custom") return "custom";
        return "All"; 
    }, [activeDurationParam]);

    const startDateParam = useUrlParam("startDate");
    const endDateParam = useUrlParam("endDate");

    const dateRange = useMemo<DateRange | undefined>(() => {
        const today = startOfDay(new Date());

        if (activeDuration === "All") return undefined;
        
        if (typeof activeDuration === 'number') {
             return { from: today, to: addDays(today, activeDuration) };
        }

        if (activeDuration === 'custom') {
            if (startDateParam && endDateParam) {
                return { from: parseISO(startDateParam), to: parseISO(endDateParam) };
            }
             return undefined;
        }
        return undefined;
    }, [activeDuration, startDateParam, endDateParam]);

    const setDaysRange = (days: number | "All" | "custom", customRange?: DateRange) => {
        urlStateManager.updateParam("planningDuration", days.toString());
        if (days === "custom" && customRange?.from && customRange?.to) {
            urlStateManager.updateParam("startDate", format(customRange.from, 'yyyy-MM-dd'));
            urlStateManager.updateParam("endDate", format(customRange.to, 'yyyy-MM-dd'));
        } else {
            urlStateManager.updateParam("startDate", null);
            urlStateManager.updateParam("endDate", null);
        }
    };

    return (
        <div className="flex flex-col h-full">
            {/* Header / Filter */}
            <div className="mb-6">
                <SevenDayPlanningHeader
                    isOverview={isOverview}
                    dateRange={dateRange}
                    activeDuration={activeDuration}
                    setDaysRange={setDaysRange}
                />
            </div>

            {/* Tabs Navigation */}
            <CashflowTabs activeTab={activeTab} onTabChange={handleTabChange} />

            {/* Tab Content */}
            <div className="flex-1">
                {activeTab === CASHFLOW_TABS.PO_CASHFLOW && <POCashflow />}
                {activeTab === CASHFLOW_TABS.WO_CASHFLOW && <WOCashflow />}
                {activeTab === CASHFLOW_TABS.MISC_CASHFLOW && <MiscCashflow />}
                {activeTab === CASHFLOW_TABS.INFLOW && <InflowCashflow />}
            </div>
        </div>
    );
};
