import React, { useMemo, useState } from "react";
import { WorkPlanItem, WorkPlanDoc } from "./SevendaysWorkPlan";
import { ChevronDown, ChevronRight, Flag, CheckCircle2, Circle, Pencil } from "lucide-react";
import { safeFormatDate } from "@/lib/utils";

interface WorkPlanOverviewProps {
    header: string;
    items: WorkPlanItem[];
    getHeaderStats: (items: WorkPlanItem[]) => { avgProgress: number; plannedActivitiesCount: number };
    isProjectManager?: boolean;
    onEditTask?: (plan: WorkPlanDoc, milestone: WorkPlanItem) => void;
}

interface FlatActivity {
    plan: WorkPlanDoc;
    milestone: WorkPlanItem;
}

interface StatusStyle {
    accent: string;       // hex for left edge bar
    progressText: string; // percentage text color
    progressBar: string;  // progress bar fill color
    dot: string;          // pill dot
    pillText: string;     // pill text
    pillBg: string;       // pill bg
    pillBorder: string;   // pill border
}

const statusStyles: Record<string, StatusStyle> = {
    "Not Started": {
        accent: "#DC2626", progressText: "text-red-600", progressBar: "bg-red-500",
        dot: "bg-red-500", pillText: "text-red-700", pillBg: "bg-red-50/50", pillBorder: "border-red-200",
    },
    "Pending": {
        accent: "#DC2626", progressText: "text-red-600", progressBar: "bg-red-500",
        dot: "bg-red-500", pillText: "text-red-700", pillBg: "bg-red-50/50", pillBorder: "border-red-200",
    },
    "In Progress": {
        accent: "#F59E0B", progressText: "text-amber-600", progressBar: "bg-amber-500",
        dot: "bg-amber-500", pillText: "text-amber-700", pillBg: "bg-amber-50/50", pillBorder: "border-amber-200",
    },
    "WIP": {
        accent: "#F59E0B", progressText: "text-amber-600", progressBar: "bg-amber-500",
        dot: "bg-amber-500", pillText: "text-amber-700", pillBg: "bg-amber-50/50", pillBorder: "border-amber-200",
    },
    "Completed": {
        accent: "#10B981", progressText: "text-emerald-600", progressBar: "bg-emerald-500",
        dot: "bg-emerald-500", pillText: "text-emerald-700", pillBg: "bg-emerald-50/50", pillBorder: "border-emerald-200",
    },
    "On Hold": {
        accent: "#9CA3AF", progressText: "text-gray-500", progressBar: "bg-gray-400",
        dot: "bg-gray-400", pillText: "text-gray-600", pillBg: "bg-gray-100/50", pillBorder: "border-gray-200",
    },
    "Not Applicable": {
        accent: "#9CA3AF", progressText: "text-gray-500", progressBar: "bg-gray-400",
        dot: "bg-gray-400", pillText: "text-gray-600", pillBg: "bg-gray-100/50", pillBorder: "border-gray-200",
    },
    "Disabled": {
        accent: "#9CA3AF", progressText: "text-gray-500", progressBar: "bg-gray-400",
        dot: "bg-gray-400", pillText: "text-gray-600", pillBg: "bg-gray-100/50", pillBorder: "border-gray-200",
    },
};

interface ActivityCardProps extends FlatActivity {
    onEditTask?: (plan: WorkPlanDoc, milestone: WorkPlanItem) => void;
}

const ActivityCard = ({ plan, milestone, onEditTask }: ActivityCardProps) => {
    const status = plan.wp_status || "Not Started";
    const styles = statusStyles[status] || statusStyles["Not Started"];
    const progress = Math.round(parseFloat(String(plan.wp_progress ?? "0")));
    const milestoneProgress = Math.round(milestone.progress || 0);
    const milestoneComplete = milestoneProgress >= 100;

    return (
        <div className="relative rounded-lg bg-white shadow-md overflow-hidden">
            {/* Accent bar — always blue, full height, flush left, curves with card corners */}
            <div
                className="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg"
                style={{ backgroundColor: "#2079DF" }}
            />

            {/* Top row: TASK label + title + Update button (right) — all vertically centered */}
            <div className="flex items-center gap-3 pl-5 pr-4 pt-3 pb-2">
                <span className="inline-flex items-center h-5 px-2 rounded text-[10px] font-semibold uppercase tracking-wide bg-blue-50 text-blue-700 border border-blue-200 shrink-0">
                    Task
                </span>
                <h5 className="text-sm font-semibold text-gray-900 leading-snug break-words flex-1" title={plan.wp_title}>
                    {plan.wp_title}
                </h5>
                {onEditTask && (
                    <button
                        type="button"
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors shrink-0"
                        onClick={(e) => {
                            e.stopPropagation();
                            onEditTask(plan, milestone);
                        }}
                        title="Update Task"
                    >
                        <Pencil className="h-3 w-3" />
                        Update
                    </button>
                )}
            </div>

            {/* Description (optional) */}
            {plan.wp_description && (
                <div className="pl-5 pr-4 pb-2 text-xs text-gray-500 leading-relaxed">
                    <span className="font-semibold text-amber-600">Note: </span>
                    {plan.wp_description}
                </div>
            )}

            {/* 4-column data grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-y-3 pl-5 pr-4 pb-3 pt-1">
                {/* Planned (left-aligned) */}
                <div className="flex flex-col gap-1 min-w-0">
                    <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Planned</span>
                    <span className="text-xs font-medium text-gray-700 truncate">
                        {safeFormatDate(plan.wp_start_date, "d MMM, yyyy")}
                        {" - "}
                        {safeFormatDate(plan.wp_end_date, "d MMM, yyyy")}
                    </span>
                </div>

                {/* Status (centered) */}
                <div className="flex flex-col gap-1 min-w-0 items-center">
                    <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Status</span>
                    <span className={`inline-flex items-center gap-1.5 h-6 w-fit rounded-md border px-2.5 text-[11px] font-medium ${styles.pillBg} ${styles.pillBorder} ${styles.pillText}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${styles.dot}`} />
                        {status}
                    </span>
                </div>

                {/* Progress (stacked: %, then bar below) — color tied to STATUS */}
                <div className="flex flex-col gap-1 min-w-0">
                    <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Progress</span>
                    <span className="text-base font-semibold tabular-nums leading-tight text-gray-900">
                        {progress}%
                    </span>
                    <div className="h-1 bg-gray-200 rounded-full overflow-hidden w-full">
                        <div
                            className={`h-full rounded-full ${styles.progressBar}`}
                            style={{ width: `${Math.min(progress, 100)}%` }}
                        />
                    </div>
                </div>

                {/* Est. Date (right-aligned) */}
                <div className="flex flex-col gap-1 min-w-0 items-end">
                    <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Est. Date</span>
                    <span className="text-xs font-medium text-gray-700 truncate">
                        {plan.wp_estimate_completion_date
                            ? safeFormatDate(plan.wp_estimate_completion_date, "d MMM, yyyy")
                            : "---"}
                    </span>
                </div>
            </div>

            {/* Footer: Milestone reference */}
            <div className="flex items-center justify-between gap-3 border-t border-gray-100 pl-5 pr-4 py-2 bg-gray-50/50 rounded-b-lg">
                <div className="flex items-center gap-2 min-w-0">
                    <Flag className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                    <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider shrink-0">
                        Milestone
                    </span>
                    <span className="text-gray-300 shrink-0">|</span>
                    <span className="text-xs font-medium text-gray-700 truncate" title={milestone.work_milestone_name}>
                        {milestone.work_milestone_name}
                    </span>
                    <span className="text-gray-300 shrink-0">|</span>
                    {(() => {
                        const milestoneStatus = milestone.status || (milestoneComplete ? "Completed" : milestoneProgress === 0 ? "Not Started" : "WIP");
                        const styles = statusStyles[milestoneStatus] || statusStyles["Not Started"];
                        return (
                            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold shrink-0 border ${styles.pillBg} ${styles.pillText} ${styles.pillBorder}`}>
                                {milestoneStatus === "Completed" ? (
                                    <CheckCircle2 className="h-3 w-3" />
                                ) : (
                                    <Circle className="h-3 w-3" />
                                )}
                                {milestoneStatus}
                                {!["Completed", "Not Started", "Not Applicable", "Disabled", "On Hold"].includes(milestoneStatus) && ` · ${milestoneProgress}%`}
                            </span>
                        );
                    })()}
                </div>

            </div>
        </div>
    );
};

export const WorkPlanOverview = ({ header, items, getHeaderStats, onEditTask }: WorkPlanOverviewProps) => {
    const { plannedActivitiesCount } = getHeaderStats(items);
    const [isExpanded, setIsExpanded] = useState(true);

    const flatActivities = useMemo<FlatActivity[]>(() => {
        const out: FlatActivity[] = [];
        items.forEach((milestone) => {
            (milestone.work_plan_doc || []).forEach((plan) => {
                out.push({ plan, milestone });
            });
        });
        return out;
    }, [items]);

    return (
        <div className={`overflow-hidden mb-4 transition-colors ${isExpanded ? "bg-gray-50 rounded-md pb-3" : "bg-white"}`}>
            {/* Header */}
            <div
                className={`flex items-center justify-between cursor-pointer transition-colors ${!isExpanded
                    ? "border bg-gray-100/50 px-3 py-3 rounded-md border-[#D7D7EC]"
                    : "py-3 px-3"
                    }`}
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex items-center gap-3">
                    <h4 className="font-bold text-gray-900 text-base">{header}</h4>
                    <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 border border-blue-200">
                        {plannedActivitiesCount} Planned Activities
                    </span>
                </div>
                <div className="text-gray-400">
                    {isExpanded ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
                </div>
            </div>

            {/* Activity Cards */}
            {isExpanded && (
                <div className="mt-2 px-3 space-y-2">
                    {flatActivities.length > 0 ? (
                        flatActivities.map(({ plan, milestone }) => (
                            <ActivityCard key={plan.name} plan={plan} milestone={milestone} onEditTask={onEditTask} />
                        ))
                    ) : (
                        <div className="rounded-md border border-dashed border-gray-200 bg-white p-4 text-center text-xs text-gray-500 italic">
                            No planned activities found.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
