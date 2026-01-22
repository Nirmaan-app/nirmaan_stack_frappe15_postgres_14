import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ProgressCircle } from "@/components/ui/ProgressCircle";
import { ArrowUpRight, Package, CheckCircle2, Clock } from "lucide-react";
import { ProjectWithMaterialPlanStats } from "../types";
import { getStatusStyle, getProgressColor, MATERIAL_PLAN_STATUSES } from "../utils";

interface MaterialPlanProjectCardProps {
  project: ProjectWithMaterialPlanStats;
  onClick?: () => void;
}

export const MaterialPlanProjectCard: React.FC<MaterialPlanProjectCardProps> = ({
  project,
  onClick,
}) => {
  const { status_counts, total_plans, overall_progress, project_name, total_pos, total_items } = project;

  const progressColor = getProgressColor(overall_progress);
  const deliveredCount = status_counts[MATERIAL_PLAN_STATUSES.DELIVERED] || 0;
  const notDeliveredCount = status_counts[MATERIAL_PLAN_STATUSES.NOT_DELIVERED] || 0;

  // Check if all plans are delivered
  const isAllDelivered = deliveredCount === total_plans && total_plans > 0;

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

          {/* Progress Circle - Shows overall progress */}
          <ProgressCircle
            value={overall_progress}
            className={`size-12 flex-shrink-0 ${progressColor}`}
            textSizeClassName="text-[10px]"
          />
        </div>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col justify-between pt-0 pb-4">
        {/* Delivery Counter - Primary Info */}
        <div className="mb-4">
          <div className="flex items-center gap-1.5 mb-1">
            <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
            <span className="text-xs text-gray-500">Plans Delivered</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className={`text-2xl font-bold tabular-nums ${progressColor}`}>
              {deliveredCount}
            </span>
            <span className="text-lg text-gray-400 font-medium">/</span>
            <span className="text-lg text-gray-500 font-semibold tabular-nums">
              {total_plans}
            </span>
          </div>
          
          {/* PO and Items counts */}
          {(total_pos || total_items) && (
            <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
              {total_pos !== undefined && total_pos > 0 && (
                <span className="flex items-center gap-1">
                  <Package className="h-3 w-3" />
                  {total_pos} POs
                </span>
              )}
              {total_items !== undefined && total_items > 0 && (
                <span>{total_items} items</span>
              )}
            </div>
          )}
        </div>

        {/* Status Breakdown */}
        {total_plans > 0 ? (
          <div className="flex-1">
            {isAllDelivered ? (
              // All plans delivered
              <div className="flex items-center justify-center py-2 px-3 rounded-md bg-green-50 text-green-700">
                <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                <span className="text-xs font-medium">All plans delivered!</span>
              </div>
            ) : (
              // Show status breakdown
              <div className="grid grid-cols-2 gap-2">
                {/* Delivered */}
                <TooltipProvider>
                  <Tooltip delayDuration={300}>
                    <TooltipTrigger asChild>
                      <div
                        className={`
                          flex items-center justify-between px-2.5 py-1.5 rounded-md
                          ${getStatusStyle(MATERIAL_PLAN_STATUSES.DELIVERED).bg} 
                          ${getStatusStyle(MATERIAL_PLAN_STATUSES.DELIVERED).text}
                          cursor-default
                        `}
                      >
                        <span className="text-[11px] font-medium truncate pr-1 flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" /> Delivered
                        </span>
                        <span className="text-xs font-bold tabular-nums">
                          {deliveredCount}
                        </span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">
                      {deliveredCount} {deliveredCount === 1 ? "plan" : "plans"} delivered
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                {/* Not Delivered */}
                {notDeliveredCount > 0 && (
                  <TooltipProvider>
                    <Tooltip delayDuration={300}>
                      <TooltipTrigger asChild>
                        <div
                          className={`
                            flex items-center justify-between px-2.5 py-1.5 rounded-md
                            ${getStatusStyle(MATERIAL_PLAN_STATUSES.NOT_DELIVERED).bg} 
                            ${getStatusStyle(MATERIAL_PLAN_STATUSES.NOT_DELIVERED).text}
                            cursor-default
                          `}
                        >
                          <span className="text-[11px] font-medium truncate pr-1 flex items-center gap-1">
                            <Clock className="h-3 w-3" /> Pending
                          </span>
                          <span className="text-xs font-bold tabular-nums">
                            {notDeliveredCount}
                          </span>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-xs">
                        {notDeliveredCount} {notDeliveredCount === 1 ? "plan" : "plans"} not yet delivered
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center py-4">
            <p className="text-xs text-gray-400 italic">No plans yet</p>
          </div>
        )}

        {/* View Details Link */}
        <div className="mt-3 pt-3 border-t border-gray-100">
          <div className="flex items-center justify-end gap-1 text-primary font-medium text-xs transition-gap group-hover:gap-1.5">
            <span>View Material Plans</span>
            <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
