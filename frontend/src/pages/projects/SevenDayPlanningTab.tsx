import React, { useMemo } from "react";
import { useParams } from "react-router-dom";
import { DateRange } from "react-day-picker";
import { addDays, startOfDay, parseISO, format } from "date-fns";
import { cn } from "@/lib/utils";
import { SevendaysWorkPlan } from "./components/planning/SevendaysWorkPlan";
import { SevenDaysMaterialPlan } from "./components/planning/SevenDaysMaterialPlan";
import { useUrlParam } from "@/hooks/useUrlParam";
import { urlStateManager } from "@/utils/urlStateManager";
import { SevenDayPlanningHeader } from "./components/planning/SevenDayPlanningHeader";
import { SevenDayPlanningTabs, PLANNING_TABS, PlanningTabValue } from "./components/planning/SevenDayPlanningTabs";

export const SevenDayPlanningTab = ({ isOverview, projectName }: { isOverview?: boolean; projectName?: string }) => {
  const { projectId } = useParams<{ projectId: string }>();

  // --- URL State Management ---

  // 1. Active Tab
  const activeTabParam = useUrlParam("planningTab");
  const activeTab = (Object.values(PLANNING_TABS).includes(activeTabParam as PlanningTabValue) 
      ? activeTabParam 
      : PLANNING_TABS.WORK_PLAN) as PlanningTabValue;

  const setActiveTab = (tab: PlanningTabValue) => {
      urlStateManager.updateParam("planningTab", tab);
  };

  // 2. Active Duration
  const activeDurationParam = useUrlParam("planningDuration");
  // Default to 3 if not present or invalid
  const activeDuration = useMemo(() => {
      if (activeDurationParam === "All") return "All";
      // Check if it's a number
      const num = Number(activeDurationParam);
      if (!isNaN(num) && [3, 7, 14].includes(num)) return num;
      if (activeDurationParam === "custom") return "custom";
      return 3; 
  }, [activeDurationParam]);

  // 3. Date Range
  const startDateParam = useUrlParam("startDate");
  const endDateParam = useUrlParam("endDate");

  const dateRange = useMemo<DateRange | undefined>(() => {
      const today = startOfDay(new Date());

      if (activeDuration === "All") {
          return undefined;
      }
      
      if (typeof activeDuration === 'number') {
           return {
               from: today,
               to: addDays(today, activeDuration)
           };
      }

      if (activeDuration === 'custom') {
          if (startDateParam && endDateParam) {
              return {
                  from: parseISO(startDateParam),
                  to: parseISO(endDateParam)
              };
          }
           // Fallback if custom but no dates in URL (shouldn't happen ideally if controlled properly)
           return undefined;
      }

      return undefined;
  }, [activeDuration, startDateParam, endDateParam]);


  // Helper to set duration (and update keys)
  const setDaysRange = (days: number | "All" | "custom", customRange?: DateRange) => {
    // 1. Update Duration Param
    urlStateManager.updateParam("planningDuration", days.toString());

    // 2. Handle Date Params
    if (days === "custom" && customRange?.from && customRange?.to) {
        urlStateManager.updateParam("startDate", format(customRange.from, 'yyyy-MM-dd'));
        urlStateManager.updateParam("endDate", format(customRange.to, 'yyyy-MM-dd'));
    } else {
        // Clear custom dates if we switch to preset or All
        urlStateManager.updateParam("startDate", null);
        urlStateManager.updateParam("endDate", null);
    }
  };


  return (
    <div className={cn(
        "flex flex-col", 
        isOverview ? "gap-4 p-6 bg-white border border-[#D7D7EC] rounded-xl shadow-sm" : "gap-6 p-4"
    )}>
      
      <SevenDayPlanningHeader 
        isOverview={isOverview}
        dateRange={dateRange}
        activeDuration={activeDuration}
        setDaysRange={setDaysRange}
      />

      {isOverview && <div className="h-px bg-[#D7D7EC] w-full" />}

      <SevenDayPlanningTabs 
        activeTab={activeTab}
        setActiveTab={setActiveTab}
      />

      {/* Tab Content Placeholder */}
      <div className={cn(
        "min-h-[300px] bg-white",
        isOverview ? "" : "border rounded-lg p-6 shadow-sm border-[#D7D7EC]"
      )}>
        {activeTab === PLANNING_TABS.WORK_PLAN && (
          <SevendaysWorkPlan 
            projectId={projectId} 
            startDate={dateRange?.from} 
            endDate={dateRange?.to} 
            isOverview={isOverview}
            projectName={projectName}
          />
        )}
        {activeTab === PLANNING_TABS.MATERIAL_PLAN && (
          <SevenDaysMaterialPlan 
            projectId={projectId!} 
            startDate={dateRange?.from} 
            endDate={dateRange?.to}
            isOverview={isOverview}
            projectName={projectName}
          />
        )}
        {activeTab === PLANNING_TABS.FINANCIAL_PLAN && (
          <div>
             <h3 className="text-lg font-medium mb-4">Financial Plan Content</h3>
             <p className="text-gray-500">Financial plan details for the selected period will appear here.</p>
          </div>
        )}
      </div>
    </div>
  );
};