import React, { useMemo } from "react";
import { cn } from "@/lib/utils";
import { useUserData } from "@/hooks/useUserData";
import { Blocks, TrendingUp, Workflow, LucideIcon } from "lucide-react";

// Make sure these match the parent's usage or export them from a shared types file
export const PLANNING_TABS = {
  WORK_PLAN: "Work Plan",
  MATERIAL_PLAN: "Material Plan",
  Cashflow_Plan: "Cashflow Plan",
} as const;

const TAB_ICONS: Partial<Record<string, LucideIcon>> = {
  [PLANNING_TABS.WORK_PLAN]: Workflow,
  [PLANNING_TABS.MATERIAL_PLAN]: Blocks,
  [PLANNING_TABS.Cashflow_Plan]: TrendingUp,
};

export type PlanningTabValue = typeof PLANNING_TABS[keyof typeof PLANNING_TABS];

interface SevenDayPlanningTabsProps {
  activeTab: PlanningTabValue;
  setActiveTab: (tab: PlanningTabValue) => void;
}

export const SevenDayPlanningTabs = ({
  activeTab,
  setActiveTab,
}: SevenDayPlanningTabsProps) => {
  const { role, user_id } = useUserData();

  const tabs = useMemo(() => {
    const allowedRolesForRestrictedTabs = [
      "Nirmaan Admin Profile",
      "Nirmaan PMO Executive Profile",
      "Nirmaan Project Lead Profile",
    ];

    const canViewRestrictedTabs =
      user_id === "Administrator" ||
      allowedRolesForRestrictedTabs.includes(role);

    if (role === "Nirmaan Procurement Executive Profile") {
      return [PLANNING_TABS.MATERIAL_PLAN];
    }

    return [
      PLANNING_TABS.WORK_PLAN,
      PLANNING_TABS.MATERIAL_PLAN,
      ...(canViewRestrictedTabs ? [PLANNING_TABS.Cashflow_Plan] : []),
    ];
  }, [role, user_id]);

  return (
    <div className="flex border rounded-md w-full sm:w-fit overflow-hidden border-[#D7D7EC]">
      {tabs.map((tab) => {
        const Icon = TAB_ICONS[tab];
        return (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "inline-flex flex-1 sm:flex-initial min-w-0 items-center justify-center gap-1.5 sm:gap-2 px-1.5 sm:px-6 py-2 text-xs sm:text-sm font-medium whitespace-nowrap transition-colors border-r border-[#D7D7EC] last:border-r-0",
              activeTab === tab
                ? "bg-red-600 text-white"
                : "bg-white text-gray-800 hover:bg-gray-50"
            )}
          >
            {Icon && <Icon className="hidden sm:block h-4 w-4 shrink-0" />}
            <span className="truncate">{tab}</span>
          </button>
        );
      })}
    </div>
  );
};
