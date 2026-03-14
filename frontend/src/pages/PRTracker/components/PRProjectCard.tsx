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
import { ProjectWithCriticalPRStats } from "../types";
import { getStatusStyle, getProgressColor } from "../utils";

interface PRProjectCardProps {
  project: ProjectWithCriticalPRStats;
  onClick?: () => void;
}

export const PRProjectCard: React.FC<PRProjectCardProps> = ({
  project,
  onClick,
}) => {
  const { status_counts, total_tags, released_tags, project_name } = project;

  const completionPercentage =
    total_tags > 0 ? Math.round((released_tags / total_tags) * 100) : 0;

  const progressColor = getProgressColor(completionPercentage);

  // Check completion status
  const isAllReleased = released_tags === total_tags && total_tags > 0;
  const notReleasedCount = status_counts["Not Released"] || 0;
  const hasIncompleteWork = notReleasedCount > 0;

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
            <span className="text-xs text-gray-500">PR Tags Released</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className={`text-2xl font-bold tabular-nums ${progressColor}`}>
              {released_tags}
            </span>
            <span className="text-lg text-gray-400 font-medium">/</span>
            <span className="text-lg text-gray-500 font-semibold tabular-nums">
              {total_tags}
            </span>
          </div>
        </div>

        {/* Status Breakdown */}
        {total_tags > 0 ? (
          <div className="flex-1">
            {hasIncompleteWork ? (
              <div className="grid grid-cols-2 gap-2">
                  <TooltipProvider>
                    <Tooltip delayDuration={300}>
                      <TooltipTrigger asChild>
                        <div
                          className={`
                            flex items-center justify-between px-2.5 py-1.5 rounded-md
                            ${getStatusStyle("Not Released")}
                            cursor-default
                          `}
                        >
                          <span className="text-[11px] font-medium truncate pr-1">
                            Not Released
                          </span>
                          <span className="text-xs font-bold tabular-nums">
                            {notReleasedCount}
                          </span>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-xs">
                        Not Released: {notReleasedCount} {notReleasedCount === 1 ? "tag" : "tags"}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
              </div>
            ) : isAllReleased ? (
              <div className="flex items-center justify-center py-2 px-3 rounded-md bg-green-50 text-green-700">
                <span className="text-xs font-medium">All PR tags released!</span>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center py-4">
            <p className="text-xs text-gray-400 italic">No tags created yet</p>
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
