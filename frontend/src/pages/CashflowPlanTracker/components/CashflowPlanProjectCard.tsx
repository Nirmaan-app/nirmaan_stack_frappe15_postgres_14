import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProgressCircle } from "@/components/ui/ProgressCircle";
import { ArrowUpRight, CircleDollarSign, Briefcase, TrendingUp, MoreHorizontal, CheckCircle2 } from "lucide-react";
import { ProjectWithCashflowPlanStats, CashflowCounts } from "../types";
import { getProgressColor } from "../utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface CashflowPlanProjectCardProps {
  project: ProjectWithCashflowPlanStats;
  onClick?: () => void;
}

interface CashflowBoxProps {
  label: string;
  fullLabel: string;
  icon: React.ReactNode;
  counts: CashflowCounts;
  colorClass: string;
  bgClass: string;
}

const CashflowBox: React.FC<CashflowBoxProps> = ({ label, fullLabel, icon, counts, colorClass, bgClass }) => (
  <TooltipProvider>
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <div className={`flex items-center justify-between px-2.5 py-1.5 rounded-md ${bgClass} border border-transparent cursor-default`}>
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={`${colorClass} flex-shrink-0`}>{icon}</span>
            <span className="text-[11px] font-semibold text-gray-700 uppercase tracking-tight truncate">{label}</span>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
            <div className="flex items-baseline gap-0.5">
              <span className={`text-xs font-bold tabular-nums ${counts.done === counts.total && counts.total > 0 ? "text-green-600" : "text-gray-900"}`}>
                {counts.done}
              </span>
              <span className="text-[10px] text-gray-400">/</span>
              <span className="text-[10px] text-gray-500 tabular-nums">{counts.total}</span>
            </div>
            {counts.done === counts.total && counts.total > 0 && (
               <CheckCircle2 className="h-3 w-3 text-green-500" />
            )}
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {counts.done} of {counts.total} {fullLabel} plans completed
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
);

export const CashflowPlanProjectCard: React.FC<CashflowPlanProjectCardProps> = ({
  project,
  onClick,
}) => {
  const { po_cashflow, wo_cashflow, inflow_cashflow, misc_cashflow, overall_progress, project_name } = project;
  const progressColor = getProgressColor(overall_progress);

  // Check if all plans are done
  const totalDone = po_cashflow.done + wo_cashflow.done + inflow_cashflow.done + misc_cashflow.done;
  const totalPlans = po_cashflow.total + wo_cashflow.total + inflow_cashflow.total + misc_cashflow.total;

  return (
    <Card
      className="
        group h-full flex flex-col
        border border-gray-200 bg-white
        transition-all duration-200
        hover:shadow-md hover:border-primary/40
        cursor-pointer
      "
      onClick={onClick}
    >
      <CardHeader className="pb-3 space-y-0">
        <div className="flex items-start justify-between gap-3">
          <CardTitle
            className="text-base font-semibold text-gray-900 line-clamp-2 leading-snug flex-1"
            title={project_name}
          >
            {project_name}
          </CardTitle>

          {/* Progress Circle */}
          <ProgressCircle
            value={overall_progress}
            className={`size-12 flex-shrink-0 ${progressColor}`}
            textSizeClassName="text-[10px]"
          />
        </div>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col justify-between pt-0 pb-4">
        {/* Summary Stats */}
        <div className="mb-4">
          <div className="flex items-center gap-1.5 mb-1">
            <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
            <span className="text-xs text-gray-500">Plans Completed</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className={`text-2xl font-bold tabular-nums ${progressColor}`}>
              {totalDone}
            </span>
            <span className="text-sm text-gray-400">/</span>
            <span className="text-sm text-gray-500 font-medium tabular-nums">
              {totalPlans}
            </span>
            <span className="text-xs text-gray-400 ml-1">plans</span>
          </div>
        </div>

        {/* Cashflow Breakdown Grid */}
        <div className="grid grid-cols-2 gap-2 mb-1">
          <CashflowBox 
            label="PO" 
            fullLabel="PO Cashflow"
            icon={<Briefcase className="h-3 w-3" />}
            counts={po_cashflow}
            colorClass="text-blue-600"
            bgClass="bg-blue-50"
          />
          <CashflowBox 
            label="WO"
            fullLabel="WO Cashflow" 
            icon={<Briefcase className="h-3 w-3" />}
            counts={wo_cashflow}
            colorClass="text-orange-600"
            bgClass="bg-orange-50"
          />
          <CashflowBox 
            label="Inflow"
            fullLabel="Inflow" 
            icon={<TrendingUp className="h-3 w-3" />}
            counts={inflow_cashflow}
            colorClass="text-emerald-600"
            bgClass="bg-emerald-50"
          />
          <CashflowBox 
            label="Misc" 
            fullLabel="Miscellaneous"
            icon={<MoreHorizontal className="h-3 w-3" />}
            counts={misc_cashflow}
            colorClass="text-purple-600"
            bgClass="bg-purple-50"
          />
        </div>

        {/* View Details Link */}
        <div className="mt-3 pt-3 border-t border-gray-100">
          <div className="flex items-center justify-end gap-1 text-primary font-medium text-xs transition-gap group-hover:gap-1.5">
            <span>View Cashflow Plans</span>
            <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
