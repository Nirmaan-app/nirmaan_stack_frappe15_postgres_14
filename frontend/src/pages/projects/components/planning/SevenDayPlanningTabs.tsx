import React from "react";
import { cn } from "@/lib/utils";

// Make sure these match the parent's usage or export them from a shared types file
export const PLANNING_TABS = {
  WORK_PLAN: "Work Plan",
  MATERIAL_PLAN: "Material Plan",
  // FINANCIAL_PLAN: "Financial Plan",
} as const;

export type PlanningTabValue = typeof PLANNING_TABS[keyof typeof PLANNING_TABS];

interface SevenDayPlanningTabsProps {
  activeTab: PlanningTabValue;
  setActiveTab: (tab: PlanningTabValue) => void;
}

export const SevenDayPlanningTabs = ({
  activeTab,
  setActiveTab,
}: SevenDayPlanningTabsProps) => {
  return (
    <div className="flex border rounded-md w-fit overflow-hidden border-[#D7D7EC]">
      {/* {[PLANNING_TABS.WORK_PLAN, PLANNING_TABS.MATERIAL_PLAN, PLANNING_TABS.FINANCIAL_PLAN].map((tab) => ( */}
      {[PLANNING_TABS.WORK_PLAN, PLANNING_TABS.MATERIAL_PLAN].map((tab) => (

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
  );
};
