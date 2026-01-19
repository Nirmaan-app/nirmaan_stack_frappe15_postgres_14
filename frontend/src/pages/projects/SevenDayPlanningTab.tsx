import React, { useMemo } from "react";
import { useParams } from "react-router-dom";
import { SevenDaysMaterialPlan } from "./components/planning/SevenDaysMaterialPlan";
import { SevendaysWorkPlan } from "./components/planning/SevendaysWorkPlan";
import { useUrlParam } from "@/hooks/useUrlParam";
import { urlStateManager } from "@/utils/urlStateManager";
import { SevenDayPlanningTabs, PLANNING_TABS, PlanningTabValue } from "./components/planning/SevenDayPlanningTabs";
import { cn } from "@/lib/utils";

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



  return (
    <div className={cn(
        "flex flex-col", 
        isOverview ? "gap-4 p-6 bg-white border border-[#D7D7EC] rounded-xl shadow-sm" : "gap-6 p-4"
    )}>
      

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
            isOverview={isOverview}
            projectName={projectName}
          />
        )}
        {activeTab === PLANNING_TABS.MATERIAL_PLAN && (
          <SevenDaysMaterialPlan 
            projectId={projectId!} 
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