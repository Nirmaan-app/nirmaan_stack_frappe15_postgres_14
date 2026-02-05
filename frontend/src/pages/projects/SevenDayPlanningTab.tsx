import React, { useMemo } from "react";
import { useParams } from "react-router-dom";
import { SevenDaysMaterialPlan } from "./components/planning/SevenDaysMaterialPlan";
import { SevendaysWorkPlan } from "./components/planning/SevendaysWorkPlan";
import { useUrlParam } from "@/hooks/useUrlParam";
import { urlStateManager } from "@/utils/urlStateManager";
import { useUserData } from "@/hooks/useUserData"; // Added import
import { SevenDayPlanningTabs, PLANNING_TABS, PlanningTabValue } from "./components/planning/SevenDayPlanningTabs";
import { cn } from "@/lib/utils";
import { CashflowPlan } from "./CashflowPlan/CashflowPlan";

export const SevenDayPlanningTab = ({ isOverview, projectName }: { isOverview?: boolean; projectName?: string }) => {
  const { projectId } = useParams<{ projectId: string }>();

  // --- URL State Management ---

  // 1. Active Tab
  const { role } = useUserData() // Added user data hook logic inline or imported
  const isProcurementExecutive = role === "Nirmaan Procurement Executive Profile";

  const activeTabParam = useUrlParam("planningTab");
  
  const defaultTab = isProcurementExecutive ? PLANNING_TABS.MATERIAL_PLAN : PLANNING_TABS.WORK_PLAN;

  const activeTab = (Object.values(PLANNING_TABS).includes(activeTabParam as PlanningTabValue) 
      ? activeTabParam 
      : defaultTab) as PlanningTabValue;

  const setActiveTab = (tab: PlanningTabValue) => {
      urlStateManager.updateParam("planningTab", tab);
  };

  // 2. Active Duration



  return (
    <div className={cn(
        "flex flex-col", 
        isOverview ? "gap-4 p-6 bg-white border border-gray-200/80 rounded-xl shadow-[0_4px_20px_-4px_rgba(0,0,0,0.12)]" : "gap-6 p-4"
    )}>
      
      {isOverview && (
        <h3 className="text-xl font-bold text-gray-900 pb-3 border-b border-[#D7D7EC]">Planning</h3>
      )}

      {/* {isOverview && <div className="h-px bg-[#D7D7EC] w-full" />} */}
      

      <SevenDayPlanningTabs 
        activeTab={activeTab}
        setActiveTab={setActiveTab}
      />

      {/* Tab Content Placeholder */}
      <div className={cn(
        "min-h-[300px]",
        (isOverview || activeTab === PLANNING_TABS.Cashflow_Plan) ? "" : "bg-white border rounded-lg p-4 md:p-6 shadow-sm border-[#D7D7EC]"
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
        {activeTab === PLANNING_TABS.Cashflow_Plan && (
          <CashflowPlan projectId={projectId || ""}  isOverview={isOverview} />
        )}
      </div>
    </div>
  );
};