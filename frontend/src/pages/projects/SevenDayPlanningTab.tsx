import React, { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { StandaloneDateFilter } from "@/components/ui/StandaloneDateFilter";
import { Button } from "@/components/ui/button";
import { DateRange } from "react-day-picker";
import { addDays, startOfDay } from "date-fns";
import { cn } from "@/lib/utils";
import { SevendaysWorkPlan } from "./components/SevendaysWorkPlan";

// Sub-tab constants
const TABS = {
  WORK_PLAN: "Work Plan",
  MATERIAL_PLAN: "Material Plan",
  FINANCIAL_PLAN: "Financial Plan",
} as const;

type TabValue = typeof TABS[keyof typeof TABS];

export const SevenDayPlanningTab = () => {
  const { projectId } = useParams<{ projectId: string }>();
  // Initialize with 3 days default
  const [activeDuration, setActiveDuration] = useState<number | "All">(3);
  
  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
      const today = startOfDay(new Date());
      return { from: today, to: addDays(today, 3) };
  });

  const [activeTab, setActiveTab] = useState<TabValue>(TABS.WORK_PLAN);

  // Helper to set date range based on days from today
  const setDaysRange = (days: number | "All") => {
    setActiveDuration(days);
    if (days === "All") {
       setDateRange(undefined); 
       return;
    }
    const today = startOfDay(new Date());
    const toDate = addDays(today, days); 
    setDateRange({
      from: today,
      to: toDate
    });
  };

  return (
    <div className="flex flex-col gap-6 p-4">
      {/* Header Section */}
      <div className="flex flex-col gap-4 border border-[#D7D7EC] rounded-xl p-6 bg-white-50">
        <div>
          <h2 className="text-2xl font-semibold">7 Day Planning</h2>
          <p className="text-gray-600">Track upcoming tasks for the next 7 days and add your follow-ups</p>
        </div>

        <div className="flex items-center gap-4 flex-wrap">
          {/* Date Filter */}
          <StandaloneDateFilter
            value={dateRange}
            onChange={(val) => {
                setDateRange(val);
                setActiveDuration('custom' as any); // Reset buttons if custom range picked
            }}
            onClear={() => {
                setDateRange(undefined);
                setActiveDuration("All");
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
          />
        )}
        {activeTab === TABS.MATERIAL_PLAN && (
          <div>
            <h3 className="text-lg font-medium mb-4">Material Plan Content</h3>
            <p className="text-gray-500">Material plan details for the selected period will appear here.</p>
          </div>
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