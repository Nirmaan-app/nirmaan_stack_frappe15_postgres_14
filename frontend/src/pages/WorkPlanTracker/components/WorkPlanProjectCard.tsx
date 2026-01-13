import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ProgressCircle } from "@/components/ui/ProgressCircle";
import { ArrowUpRight } from "lucide-react";
import { ProjectWithWorkPlanStats } from "../types";
import { getStatusStyle, getProgressColor, STATUS_DISPLAY_ORDER } from "../utils";

interface WorkPlanProjectCardProps {
  project: ProjectWithWorkPlanStats;
  onClick?: () => void;
}

export const WorkPlanProjectCard: React.FC<WorkPlanProjectCardProps> = ({
  project,
  onClick,
}) => {
  const { status_counts, total_activities, overall_progress, project_name } = project;

  const progressColor = getProgressColor(overall_progress);

  // Get ordered status entries for display
  const orderedStatusEntries = STATUS_DISPLAY_ORDER.map((status) => ({
    status,
    count: status_counts[status] || 0,
  })).filter((entry) => entry.count > 0);

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
        {/* Activity Counter */}
        <div className="mb-4">
          <div className="text-xs text-gray-500 mb-1">Planned Activities</div>
          <div className="flex items-baseline gap-1.5">
            <span className={`text-2xl font-bold tabular-nums ${progressColor}`}>
              {total_activities}
            </span>
            <span className="text-sm text-gray-400">activities</span>
          </div>
        </div>

        {/* Status Breakdown */}
        {total_activities > 0 ? (
          <div className="flex-1">
            <div className="grid grid-cols-1 gap-2">
              {orderedStatusEntries.map(({ status, count }) => (
                <TooltipProvider key={status}>
                  <Tooltip delayDuration={300}>
                    <TooltipTrigger asChild>
                      <div
                        className={`
                          flex items-center justify-between px-2.5 py-1.5 rounded-md
                          ${getStatusStyle(status).bg} ${getStatusStyle(status).text}
                          cursor-default
                        `}
                      >
                        <span className="text-[11px] font-medium truncate pr-1">
                          {status}
                        </span>
                        <span className="text-xs font-bold tabular-nums">
                          {count}
                        </span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">
                      {status}: {count} {count === 1 ? "activity" : "activities"}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center py-4">
            <p className="text-xs text-gray-400 italic">No activities yet</p>
          </div>
        )}

        {/* View Details Link */}
        <div className="mt-3 pt-3 border-t border-gray-100">
          <div className="flex items-center justify-end gap-1 text-primary font-medium text-xs transition-gap group-hover:gap-1.5">
            <span>View Work Plan</span>
            <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
