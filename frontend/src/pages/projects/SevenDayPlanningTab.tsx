import React, { useState, useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
import { StandaloneDateFilter } from "@/components/ui/StandaloneDateFilter";
import { Button } from "@/components/ui/button";
import { DateRange } from "react-day-picker";
import { addDays, startOfDay, parseISO, format } from "date-fns";
import { cn } from "@/lib/utils";
import { SevendaysWorkPlan } from "./components/SevendaysWorkPlan";
import { SevenDaysMaterialPlan } from "./components/SevenDaysMaterialPlan";
import { useUrlParam } from "@/hooks/useUrlParam";
import { urlStateManager } from "@/utils/urlStateManager";

// Sub-tab constants
const TABS = {
  WORK_PLAN: "Work Plan",
  MATERIAL_PLAN: "Material Plan",
  FINANCIAL_PLAN: "Financial Plan",
} as const;

type TabValue = typeof TABS[keyof typeof TABS];

export const SevenDayPlanningTab = ({ isOverview }: { isOverview?: boolean }) => {
  const { projectId } = useParams<{ projectId: string }>();

  // --- URL State Management ---

  // 1. Active Tab
  const activeTabParam = useUrlParam("planningTab");
  const activeTab = (Object.values(TABS).includes(activeTabParam as TabValue) 
      ? activeTabParam 
      : TABS.WORK_PLAN) as TabValue;

  const setActiveTab = (tab: TabValue) => {
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
    <div className="flex flex-col gap-6 p-4">
      {/* Header Section */}
      <div className="flex flex-col gap-4 border border-[#D7D7EC] rounded-xl p-6 bg-white-50">
        <div>
          <h2 className="text-2xl font-semibold">{isOverview ? "Overview" : "Planning"}</h2>
          <p className="text-gray-600">Track upcoming tasks for the next 7 days and add your follow-ups</p>
        </div>

        <div className="flex items-center gap-4 flex-wrap">
          {/* Date Filter */}
          <StandaloneDateFilter
            value={dateRange}
            onChange={(val) => {
                // When picking from DatePicker, it's a "Custom" range
                if (val?.from && val?.to) {
                     setDaysRange('custom', val);
                } else if (!val) {
                    setDaysRange('All');
                }
            }}
            onClear={() => {
                setDaysRange("All");
            }}
          />

          {/* Duration Buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            {[3, 7, 14, "All"].map((duration) => (
                <Button
                key={duration}
                variant={activeDuration === duration ? "default" : "outline"}
                className={cn(
                    activeDuration === duration 
                        ? "bg-red-600 hover:bg-red-700 text-white" 
                        : "bg-white text-gray-400  hover:bg-red-50 hover:text-red-600 hover:border-red-200 border border-[#D7D7EC]"
                )}
                onClick={() => setDaysRange(duration as number | "All")}
                >
                {duration === "All" ? "All" : `${duration} Days`}
                </Button>
            ))}
          </div>
        </div>
      </div>

      {/* Tabs Switcher - Matching the visual from image with custom border */}
      <div className="flex border rounded-md w-fit overflow-hidden border-[#D7D7EC]">
        {[TABS.WORK_PLAN, TABS.MATERIAL_PLAN, TABS.FINANCIAL_PLAN].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "px-6 py-2 text-sm font-medium transition-colors border-r border-[#D7D7EC] last:border-r-0",
              activeTab === tab
                ? "bg-red-600 text-white"
                : "bg-white text-gray-800 hover:bg-gray-50"
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab Content Placeholder */}
      <div className="min-h-[300px] border rounded-lg p-6 bg-white shadow-sm border-[#D7D7EC]">
        {activeTab === TABS.WORK_PLAN && (
          <SevendaysWorkPlan 
            projectId={projectId} 
            startDate={dateRange?.from} 
            endDate={dateRange?.to} 
            isOverview={isOverview}
          />
        )}
        {activeTab === TABS.MATERIAL_PLAN && (
          <SevenDaysMaterialPlan 
            projectId={projectId} 
            startDate={dateRange?.from} 
            endDate={dateRange?.to}
          />
        )}
        {activeTab === TABS.FINANCIAL_PLAN && (
          <div>
             <h3 className="text-lg font-medium mb-4">Financial Plan Content</h3>
             <p className="text-gray-500">Financial plan details for the selected period will appear here.</p>
          </div>
        )}
      </div>
    </div>
  );
};