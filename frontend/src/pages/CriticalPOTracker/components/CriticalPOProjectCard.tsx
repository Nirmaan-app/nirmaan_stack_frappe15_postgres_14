import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ProgressCircle } from "@/components/ui/ProgressCircle";
import { ArrowUpRight, CheckCircle2 } from "lucide-react";
import { ProjectWithCriticalPOStats } from "../types";
import { getStatusStyle, getProgressColor } from "../utils";

interface CriticalPOProjectCardProps {
  project: ProjectWithCriticalPOStats;
  onClick?: () => void;
}

export const CriticalPOProjectCard: React.FC<CriticalPOProjectCardProps> = ({
  project,
  onClick,
}) => {
  const { status_counts, total_tasks, released_tasks, project_name } = project;

  const completionPercentage =
    total_tasks > 0 ? Math.round((released_tasks / total_tasks) * 100) : 0;

  const progressColor = getProgressColor(completionPercentage);

  // Check completion status
  const isAllReleased = released_tasks === total_tasks && total_tasks > 0;
  const notReleasedCount = status_counts["Not Released"] || 0;
  const partiallyReleasedCount = status_counts["Partially Released"] || 0;
  const hasIncompleteWork = notReleasedCount > 0 || partiallyReleasedCount > 0;

  // Get incomplete status entries for display (exclude "Released" since it's the primary metric)
  const incompleteStatusEntries = [
    { status: "Partially Released" as const, count: partiallyReleasedCount },
    { status: "Not Released" as const, count: notReleasedCount },
  ].filter((entry) => entry.count > 0);

  // All status entries for data mismatch fallback
  const allStatusEntries = [
    { status: "Released" as const, count: status_counts["Released"] || 0 },
    { status: "Partially Released" as const, count: partiallyReleasedCount },
    { status: "Not Released" as const, count: notReleasedCount },
  ].filter((entry) => entry.count > 0);

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

          {/* Progress Circle - Shows released percentage */}
          <ProgressCircle
            value={completionPercentage}
            className={`size-12 flex-shrink-0 ${progressColor}`}
            textSizeClassName="text-[10px]"
          />
        </div>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col justify-between pt-0 pb-4">
        {/* Completion Counter - Primary Info */}
        <div className="mb-4">
          <div className="flex items-center gap-1.5 mb-1">
            <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
            <span className="text-xs text-gray-500">POs Released</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className={`text-2xl font-bold tabular-nums ${progressColor}`}>
              {released_tasks}
            </span>
            <span className="text-lg text-gray-400 font-medium">/</span>
            <span className="text-lg text-gray-500 font-semibold tabular-nums">
              {total_tasks}
            </span>
          </div>
        </div>

        {/* Status Breakdown */}
        {total_tasks > 0 ? (
          <div className="flex-1">
            {hasIncompleteWork ? (
              // Show only incomplete statuses (Not Released, Partially Released)
              <div className="grid grid-cols-2 gap-2">
                {incompleteStatusEntries.map(({ status, count }) => (
                  <TooltipProvider key={status}>
                    <Tooltip delayDuration={300}>
                      <TooltipTrigger asChild>
                        <div
                          className={`
                            flex items-center justify-between px-2.5 py-1.5 rounded-md
                            ${getStatusStyle(status)}
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
                        {status}: {count} {count === 1 ? "task" : "tasks"}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ))}
              </div>
            ) : isAllReleased ? (
              // All POs are released
              <div className="flex items-center justify-center py-2 px-3 rounded-md bg-green-50 text-green-700">
                <span className="text-xs font-medium">All POs released!</span>
              </div>
            ) : allStatusEntries.length > 0 ? (
              // Data mismatch - show all available statuses
              <div className="grid grid-cols-2 gap-2">
                {allStatusEntries.map(({ status, count }) => (
                  <TooltipProvider key={status}>
                    <Tooltip delayDuration={300}>
                      <TooltipTrigger asChild>
                        <div
                          className={`
                            flex items-center justify-between px-2.5 py-1.5 rounded-md
                            ${getStatusStyle(status)}
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
                        {status}: {count} {count === 1 ? "task" : "tasks"}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center py-4">
            <p className="text-xs text-gray-400 italic">No tasks created yet</p>
          </div>
        )}

        {/* View Details Link */}
        <div className="mt-3 pt-3 border-t border-gray-100">
          <div className="flex items-center justify-end gap-1 text-primary font-medium text-xs transition-gap group-hover:gap-1.5">
            <span>View Details</span>
            <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
