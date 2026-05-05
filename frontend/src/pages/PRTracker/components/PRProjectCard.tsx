import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProgressCircle } from "@/components/ui/ProgressCircle";
import { ArrowUpRight, CheckCircle2 } from "lucide-react";
import { ProjectStatusBadge } from "@/components/common/ProjectStatusBadge";
import { ProjectWithCriticalPRStats } from "../types";
import { getProgressColor } from "../utils";

interface PRProjectCardProps {
  project: ProjectWithCriticalPRStats;
  onClick?: () => void;
}

export const PRProjectCard: React.FC<PRProjectCardProps> = ({
  project,
  onClick,
}) => {
  const {
    total_tags,
    project_name,
    status_of_project,
    total_enabled_packages,
    used_packages_count,
    total_available_headers,
    used_headers_count,
    total_prs
  } = project;

  const completionPercentage =
    total_available_headers > 0 ? Math.round((used_headers_count / total_available_headers) * 100) : 0;

  const progressColor = getProgressColor(completionPercentage);

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
          <div className="flex-1 min-w-0 flex items-start gap-2 flex-wrap">
            <CardTitle
              className="text-base font-semibold text-gray-900 line-clamp-2 leading-snug min-w-0"
              title={project_name}
            >
              {project_name}
            </CardTitle>
            <ProjectStatusBadge status={status_of_project} />
          </div>

          {/* Progress Circle - Shows released percentage */}
          <ProgressCircle
            value={completionPercentage}
            className={`size-12 flex-shrink-0 ${progressColor}`}
            textSizeClassName="text-[10px]"
          />
        </div>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col justify-between pt-0 pb-3">
        {/* Stats Summary */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          {/* Packages Stat */}
          <div className="bg-blue-50/50 p-2 rounded-lg border border-blue-100/50 flex flex-col justify-between">
            <span className="text-[10px] uppercase tracking-wider text-blue-600 font-bold">Packages</span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-lg font-bold text-blue-700 tabular-nums">{used_packages_count}</span>
              <span className="text-xs text-blue-400 font-medium">/ {total_enabled_packages}</span>
            </div>
            <span className="text-[9px] text-blue-500/80 font-medium mt-0.5">Used total</span>
          </div>

          {/* Headers Stat */}
          <div className="bg-purple-50/50 p-2 rounded-lg border border-purple-100/50 flex flex-col justify-between">
            <span className="text-[10px] uppercase tracking-wider text-purple-600 font-bold">Headers</span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-lg font-bold text-purple-700 tabular-nums">{used_headers_count}</span>
              <span className="text-xs text-purple-400 font-medium">/ {total_available_headers}</span>
            </div>
            <span className="text-[9px] text-purple-500/80 font-medium mt-0.5">Used total</span>
          </div>
        </div>

        {total_tags > 0 ? (
          <div className="flex items-center justify-between py-2 px-3 bg-gray-50/50 rounded-lg border border-gray-100/50 mb-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-blue-600" />
              <span className="text-xs font-semibold text-gray-700">Total PRs Created</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-xl font-bold tabular-nums text-blue-700">{total_prs}</span>
              <span className="text-[10px] text-gray-400 font-medium italic">PRs</span>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center py-2">
            <p className="text-xs text-gray-400 italic">No PR Tags created yet</p>
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
