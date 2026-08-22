/**
 * One project's snag standing, as a card on the `/snag-list` grid.
 *
 * Deliberately the SAME card language as the Design Tracker's `ProjectWiseCard`
 * (left-border accent status block, progress ring, Hide toggle, "View Details" footer)
 * — the two grids sit one above the other in the sidebar and reading as one family is
 * the point. What differs is only what a snag HAS: statuses instead of phases.
 *
 * HIDE lives on `Projects.disabled_snag_list`, not on a snag document — a snag list has
 * no document of its own to carry the flag (a Project Snag is standalone, ADR-0017). It
 * is the same per-project module switch as DPR / Inventory / PMO, so the write goes
 * through `api.projects.module_controls`, NOT a direct `updateDoc` — that endpoint is
 * where the Admin/PMO gate is enforced.
 */

import React, { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ProgressCircle } from "@/components/ui/ProgressCircle";
import { ProjectStatusBadge } from "@/components/common/ProjectStatusBadge";
import {
  ArrowUpRight,
  CheckCircle2,
  Eye,
  EyeOff,
  Layers,
  Loader2,
  MapPin,
} from "lucide-react";

import { SNAG_STATUS_BADGE_STYLES } from "../config/snagTable.config";
import { ProjectSnagSummary, SnagStatus } from "../types";

/** Statuses that represent OPEN work, in display order. `Completed` is the target, not a chip. */
const OPEN_STATUSES: SnagStatus[] = ["Pending", "WIP"];

const formatUploadDate = (value: string | null): string | null => {
  if (!value) return null;
  const parsed = new Date(value.replace(" ", "T"));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "2-digit",
  });
};

export interface ProjectSnagCardProps {
  summary: ProjectSnagSummary;
  onClick?: () => void;
  /**
   * Withheld entirely when the viewer may not toggle the module — presence of the
   * callback IS the permission gate, the same signal `SnagListTab` uses for its own
   * write controls. There is no second `canHide` prop to fall out of step with it.
   */
  onHideToggle?: (projectId: string, nextHidden: boolean) => void;
  /** True while THIS card's toggle is in flight. */
  isToggling?: boolean;
}

export const ProjectSnagCard: React.FC<ProjectSnagCardProps> = ({
  summary,
  onClick,
  onHideToggle,
  isToggling = false,
}) => {
  const isCEOHold = summary.status_of_project === "CEO Hold";
  const isHidden = summary.is_hidden === 1;

  const { trackable, completed, notApplicable, openChips, allDone } = useMemo(() => {
    const byStatus = summary.by_status;
    const na = byStatus["Not Applicable"] ?? 0;
    // `Not Applicable` is a DISPOSAL, not progress — it leaves the denominator entirely
    // (same treatment the design tracker gives its own "Not Applicable" tasks).
    const trackableCount = Math.max(summary.total - na, 0);
    const done = byStatus.Completed ?? 0;
    return {
      trackable: trackableCount,
      completed: done,
      notApplicable: na,
      openChips: OPEN_STATUSES.map((status) => ({
        status,
        count: byStatus[status] ?? 0,
      })).filter((c) => c.count > 0),
      allDone: trackableCount > 0 && done === trackableCount,
    };
  }, [summary.by_status, summary.total]);

  const completionPercentage =
    trackable === 0 ? 0 : Math.round((completed / trackable) * 100);

  // Same thresholds as the design tracker ring, so a colour means the same thing on
  // both grids.
  const progressColor =
    completionPercentage >= 76
      ? "text-green-600"
      : completionPercentage >= 26
        ? "text-yellow-500"
        : "text-red-600";

  const lastUpload = formatUploadDate(summary.last_upload);

  return (
    <Card
      className={`
        group h-full flex flex-col
        border
        transition-all duration-200
        hover:shadow-md hover:border-primary/40
        cursor-pointer
        ${isCEOHold
          ? "border-red-300 bg-red-50 hover:bg-red-100"
          : isHidden
            ? "border-orange-300 bg-orange-50/30"
            : "border-gray-200 bg-white"}
      `}
      onClick={onClick}
    >
      <CardHeader className="pb-3 space-y-0">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 flex flex-col gap-1">
            {isHidden && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 w-fit bg-orange-100 text-orange-700 border-orange-300"
              >
                <EyeOff className="h-2.5 w-2.5 mr-1" />
                Hidden
              </Badge>
            )}
            <div className="flex items-center gap-1.5 flex-wrap">
              <CardTitle
                className="text-base font-semibold text-gray-900 line-clamp-2 leading-snug"
                title={summary.project_name}
              >
                {summary.project_name}
              </CardTitle>
              <ProjectStatusBadge status={summary.status_of_project} />
            </div>
            {summary.project_city && (
              <span className="flex items-center gap-1 text-[11px] text-gray-400">
                <MapPin className="h-3 w-3 shrink-0" />
                {summary.project_city}
              </span>
            )}
          </div>

          <ProgressCircle
            value={completionPercentage}
            className={`size-12 flex-shrink-0 ${progressColor}`}
            textSizeClassName="text-[10px]"
          />
        </div>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col justify-between pt-0 pb-4">
        <div className="flex-1">
          {trackable > 0 ? (
            <div
              className={`border-l-2 rounded-r-md pl-2.5 pr-2 py-1.5 ${
                allDone
                  ? "border-l-green-400 bg-green-50/40"
                  : "border-l-amber-400 bg-amber-50/40"
              }`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`text-[11px] font-semibold uppercase tracking-wider ${
                    allDone ? "text-green-700" : "text-amber-700"
                  }`}
                >
                  Snags Closed
                </span>
                <div className="flex items-center gap-1">
                  <span
                    className={`text-xs font-bold tabular-nums ${
                      allDone ? "text-green-700" : "text-amber-700"
                    }`}
                  >
                    {completed}/{trackable}
                  </span>
                  {allDone && <CheckCircle2 className="h-3 w-3 text-green-500" />}
                </div>
              </div>

              {allDone ? (
                <span className="text-[10px] text-green-600 mt-0.5 block">
                  All snags closed
                </span>
              ) : openChips.length > 0 ? (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {openChips.map(({ status, count }) => (
                    <TooltipProvider key={status}>
                      <Tooltip delayDuration={300}>
                        <TooltipTrigger asChild>
                          <div
                            className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium cursor-default ${SNAG_STATUS_BADGE_STYLES[status]}`}
                          >
                            <span className="truncate">{status}</span>
                            <span className="font-bold tabular-nums">{count}</span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs">
                          {status}: {count} {count === 1 ? "snag" : "snags"}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex items-center justify-center py-4">
              <p className="text-xs text-gray-400 italic">
                {summary.total > 0
                  ? "Every snag is marked Not Applicable"
                  : "No snags imported yet"}
              </p>
            </div>
          )}

          {notApplicable > 0 && trackable > 0 && (
            <p className="mt-1.5 text-[10px] text-gray-400">
              {notApplicable} marked Not Applicable
            </p>
          )}
        </div>

        {/* Provenance — how the list got here. A project with no batch holds only
            manually-added snags, and that absence is worth showing. */}
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-gray-500">
          <Layers className="h-3 w-3 shrink-0 text-gray-400" />
          {summary.batch_count > 0 ? (
            <span>
              {summary.batch_count}{" "}
              {summary.batch_count === 1 ? "import" : "imports"}
              {lastUpload ? ` · last ${lastUpload}` : ""}
            </span>
          ) : (
            <span>Manually added</span>
          )}
        </div>

        <div className="mt-3 pt-3 border-t border-gray-100">
          <div className="flex items-center justify-between">
            {onHideToggle ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={isToggling}
                className="h-6 text-[10px] px-2 gap-1 text-gray-500 hover:text-orange-600"
                onClick={(e) => {
                  // The whole card navigates — without this the toggle would open the
                  // project it was meant to hide.
                  e.stopPropagation();
                  onHideToggle(summary.name, !isHidden);
                }}
              >
                {isToggling ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Saving
                  </>
                ) : isHidden ? (
                  <>
                    <Eye className="h-3 w-3" />
                    Unhide
                  </>
                ) : (
                  <>
                    <EyeOff className="h-3 w-3" />
                    Hide
                  </>
                )}
              </Button>
            ) : (
              <div /> /* keeps "View Details" pinned right */
            )}

            <div className="flex items-center gap-1 text-primary font-medium text-xs transition-gap group-hover:gap-1.5">
              <span>View Details</span>
              <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
