

import React, { useMemo, useState, useEffect } from "react";
import { useFrappeGetCall, useFrappeGetDoc, useFrappeDeleteDoc } from "frappe-react-sdk";
import { format } from "date-fns";
import { AlertCircle, Loader2, ChevronDown, ChevronUp, Pencil, Trash2, Download, Play, Flag, Activity, TrendingUp, Target, Zap } from "lucide-react";
import { ProgressCircle } from "@/components/ui/ProgressCircle";
import { CreateWorkplantask } from "./CreateWorkplantask";
import { WorkPlanOverview } from "./WorkPlanOverview";
import { ProjectManagerEditWorkPlanDialog } from "./ProjectManagerEditWorkPlanDialog";

import { useToast } from "@/components/ui/use-toast";
import { useUrlParam } from "@/hooks/useUrlParam";
import { urlStateManager } from "@/utils/urlStateManager";
import { Button } from "@/components/ui/button";
import { useUserData } from "@/hooks/useUserData";
import { EditMilestoneDialog } from "./EditMilestoneDialog";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

interface SevendaysWorkPlanProps {
    projectId: string;
    startDate: Date | undefined;
    endDate: Date | undefined;
    isOverview?: boolean;
    projectName?: string;
}

export interface WorkPlanItem {
    project: string;
    zone: string;
    work_milestone_name: string;
    work_header: string;
    status: string;
    progress: number;
    expected_starting_date: string;
    expected_completion_date: string;
    work_plan_doc?: WorkPlanDoc[];
    source: string;
    weightage?: number;
    dpr_name?: string;
}

export interface WorkPlanDoc {
    name: string;
    wp_title: string;
    wp_status: string;
    wp_start_date: string;
    wp_end_date: string;
    wp_description: string;
    wp_progress?: string;
    wp_estimate_completion_date?: string;
}

export const getColorForProgress = (value: number): string => {
    const val = Math.round(value);
    if (isNaN(val)) return "text-gray-500";
    if (val === 0) return "text-gray-400";
    if (val < 50) return "text-red-600";
    if (val < 75) return "text-yellow-600";
    if (val < 100) return "text-green-600";
    return "text-green-500";
};

// Format date as dd-MMM-yyyy (e.g., 15-Jan-2024)
const formatDate = (dateStr: string | undefined | null): string => {
    if (!dateStr) return '—';
    try {
        return format(new Date(dateStr), 'dd-MMM-yyyy');
    } catch {
        return dateStr;
    }
};

// Mobile Card Component for Milestone
const MilestoneCard = ({ item, onAddTask, onEditMilestone, isOverview, isProjectManager }: {
    item: WorkPlanItem,
    onAddTask: (item: WorkPlanItem) => void,
    onEditMilestone: (item: WorkPlanItem) => void,
    isOverview?: boolean,
    isProjectManager?: boolean
}) => {
    return (
        <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
            {/* Title Row */}
            <div className="flex items-start justify-between gap-2">
                <h4 className="font-semibold text-gray-900 text-sm leading-tight flex-1">
                    {item.work_milestone_name}
                </h4>
                {!isOverview && !isProjectManager && (
                    <button
                        className="flex-shrink-0 p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-all"
                        onClick={() => onEditMilestone(item)}
                        title="Edit Milestone"
                    >
                        <Pencil className="h-3.5 w-3.5" />
                    </button>
                )}
            </div>

            {/* Status & Progress Row */}
            <div className="flex items-center justify-between">
                <span
                    className={`inline-flex items-center justify-center h-6 rounded-full px-2.5 text-[11px] font-medium whitespace-nowrap ${item.status === "Completed"
                        ? "bg-green-100 text-green-800 border border-green-200"
                        : item.status === "WIP" || item.status === "In Progress"
                            ? "bg-orange-100 text-orange-800 border border-orange-200"
                            : item.status === "Not Started"
                                ? "bg-red-100 text-red-800 border border-red-200"
                                : "bg-gray-100 text-gray-800 border border-gray-200"
                        }`}
                >
                    {item.status}
                </span>
                <div className="flex items-center gap-2">
                    <ProgressCircle
                        value={item.progress}
                        className={`size-9 ${getColorForProgress(item.progress)}`}
                        textSizeClassName="text-[9px]"
                    />
                </div>
            </div>

            {/* Dates Row */}
            <div className="flex items-center gap-4 text-xs">
                <div className="flex items-center gap-1.5">
                    <Play className="h-3 w-3 text-gray-400" />
                    <span className="text-gray-500">Start:</span>
                    <span className="font-semibold text-gray-700">
                        {item.expected_starting_date ? formatDate(item.expected_starting_date) : "NA"}
                    </span>
                </div>
                <div className="flex items-center gap-1.5">
                    <Flag className="h-3 w-3 text-gray-400" />
                    <span className="text-gray-500">End:</span>
                    <span className="font-semibold text-gray-700">
                        {item.expected_completion_date ? formatDate(item.expected_completion_date) : "NA"}
                    </span>
                </div>
            </div>

            {/* Add Task Button */}
            {!isOverview && !isProjectManager && (
                <button
                    className="w-full flex items-center justify-center rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100 transition-colors"
                    onClick={() => onAddTask(item)}
                >
                    <span className="mr-1 text-lg leading-none">+</span> Add Task
                </button>
            )}
        </div>
    );
};

const MilestoneRow = ({ item, onAddTask, onEditTask, onDeleteTask, onEditMilestone, isOverview, isProjectManager }: {
    item: WorkPlanItem,
    onAddTask: (item: WorkPlanItem) => void,
    onEditTask: (plan: WorkPlanDoc, item: WorkPlanItem) => void,
    onDeleteTask: (planName: string) => void,
    onEditMilestone: (item: WorkPlanItem) => void,
    isOverview?: boolean,
    isProjectManager?: boolean
}) => {
    // Default to expanded for Project Managers
    const [isExpanded, setIsExpanded] = useState(isProjectManager || false);
    const workPlans = item.work_plan_doc || [];
    const hasWorkPlans = workPlans.length > 0;

    return (
        <>
            {/* Desktop Table Row - Hidden on mobile/tablet */}
            <tr className="hover:bg-gray-50/50 hidden lg:table-row">
                <td className="px-4 py-3 text-gray-700 border-b-0">
                    <div className="font-medium text-gray-900">{item.work_milestone_name}</div>
                </td>
                <td className="px-4 py-3 border-b-0 text-center">
                    <span
                        className={`inline-flex items-center justify-center h-6 min-w-[100px] w-fit rounded-full px-3 text-xs font-medium whitespace-nowrap ${item.status === "Completed"
                            ? "bg-green-100 text-green-800 border border-green-200"
                            : item.status === "WIP" || item.status === "In Progress"
                                ? "bg-orange-100 text-orange-800 border border-orange-200"
                                : item.status === "Not Started"
                                    ? "bg-red-100 text-red-800 border border-red-200"
                                    : "bg-gray-100 text-gray-800 border border-gray-200"
                            }`}
                    >
                        {item.status}
                        {!isOverview && !isProjectManager && (
                            <button
                                className="ml-2 p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50  transition-all inline-flex items-center"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onEditMilestone(item);
                                }}
                                title="Edit Milestone"
                            >
                                <Pencil className="h-3 w-3" />
                            </button>
                        )}
                    </span>

                </td>

                <td className="px-4 py-3 text-gray-700 border-b-0 text-center">
                    <div className="flex items-center justify-center gap-2">
                        <ProgressCircle
                            value={item.progress}
                            className={`size-10 ${getColorForProgress(item.progress)}`}
                            textSizeClassName="text-[10px]"
                        />
                    </div>
                </td>
                <td className="px-4 py-3 text-xs font-medium text-gray-700 border-b-0 text-center">
                    {item.expected_starting_date ? (
                        <span className="text-red-600 font-bold">{formatDate(item.expected_starting_date)}</span>
                    ) : "NA"}
                </td>
                <td className="px-4 py-3 text-xs font-medium text-gray-700 border-b-0 text-center">
                    {item.expected_completion_date ? (
                        <span className="text-red-600 font-bold">{formatDate(item.expected_completion_date)}</span>
                    ) : "NA"}
                </td>
                {!isOverview && !isProjectManager && (
                    <td className="px-4 py-3 border-b-0">
                        <button
                            className="flex items-center rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-colors"
                            onClick={() => onAddTask(item)}
                        >
                            <span className="mr-1 text-lg leading-none">+</span> Add Task
                        </button>
                    </td>
                )}
            </tr>

            {/* Mobile/Tablet Card Row - Shown on mobile and tablet */}
            <tr className="lg:hidden">
                <td colSpan={(isOverview || isProjectManager) ? 5 : 6} className="p-2 border-b border-gray-100">
                    <MilestoneCard
                        item={item}
                        onAddTask={onAddTask}
                        onEditMilestone={onEditMilestone}
                        isOverview={isOverview}
                        isProjectManager={isProjectManager}
                    />
                </td>
            </tr>
            {hasWorkPlans && (
                <tr>
                    <td colSpan={(isOverview || isProjectManager) ? 5 : 6} className="pb-2 pt-0 m-0 p-0">
                        <div className="rounded-md border-b bg-blue-50/30">
                            <button
                                className="flex w-full items-center justify-between px-4 py-2 text-sm text-blue-800 hover:bg-blue-50"
                                onClick={() => setIsExpanded(!isExpanded)}
                            >
                                <div className="flex items-center gap-2 font-semibold">
                                    Planned Activities
                                    <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-blue-700 text-white text-[10px] font-bold">
                                        {workPlans.length}
                                    </span>
                                </div>
                                {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </button>

                            {isExpanded && (
                                <div className="space-y-2 p-4">
                                    {/* Header Row */}
                                    {/* <div className="grid grid-cols-[1fr_1fr_2fr_auto] divide-x divide-gray-100 items-center rounded-t-lg bg-gray-50 border border-gray-200 text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                                        <div className="p-3"></div>
                                        <div className="flex items-center justify-center gap-8 p-3">
                                            <span className="w-[80px] text-center">End Date</span>
                                            <span className="w-[80px] text-center">Start Date</span>
                                        </div>
                                        <div className="flex items-center justify-center gap-8 p-3">
                                            <span className="w-[70px] text-center">Status</span>
                                            <span className="w-[60px] text-center">Percentage</span>
                                            <span className="text-center">Estimated Completion Date</span>
                                        </div>
                                        <div className="p-3 text-center">Action</div>
                                    </div> */}
                                    {/* Data Rows - Enterprise Minimalist Cards with Labels */}
                                    {workPlans.map((plan) => {
                                        const progressNum = parseInt(plan.wp_progress || '0', 10);

                                        return (
                                            <div
                                                key={plan.name}
                                                className="bg-white border border-gray-150 rounded-lg hover:border-gray-200 transition-colors"
                                            >
                                                {/* Two-row layout: Title row + Data row */}
                                                <div className="px-4 py-3 border-b border-gray-100">
                                                    <h4 className="text-sm font-semibold text-gray-900 leading-tight" title={plan.wp_title}>
                                                        {plan.wp_title}
                                                    </h4>
                                                    {plan.wp_description && (
                                                        <p className="mt-1.5 text-xs text-gray-500 leading-relaxed">
                                                            <span className="font-medium text-amber-600">Note:</span>{" "}
                                                            {plan.wp_description}
                                                        </p>
                                                    )}
                                                </div>

                                                {/* Data Fields Row - Two Sections (Responsive: stack on mobile/tablet, horizontal on desktop) */}
                                                <div className="flex flex-col lg:flex-row lg:items-stretch">
                                                    {/* SECTION 1: Admin/Lead Defined - Planning Dates */}
                                                    <div className="flex flex-col lg:flex-row lg:items-center bg-blue-50/40 border-b-2 lg:border-b-0 lg:border-r-2 border-blue-100">
                                                        {/* Section Label - Horizontal on mobile/tablet, Vertical on desktop */}
                                                        <div className="hidden lg:block px-2 py-2.5 border-r border-blue-100/50">
                                                            <div className="text-[9px] font-semibold text-blue-600 uppercase tracking-wider whitespace-nowrap [writing-mode:vertical-lr] rotate-180">
                                                                Planned
                                                            </div>
                                                        </div>
                                                        {/* Mobile/Tablet Section Header */}
                                                        <div className="lg:hidden w-full px-3 py-1.5 border-b border-blue-100/50 bg-blue-100/30">
                                                            <span className="text-[10px] font-semibold text-blue-600 uppercase tracking-wider">
                                                                Planned
                                                            </span>
                                                        </div>

                                                        {/* Start & End Dates - Grid on mobile/tablet, Flex on desktop */}
                                                        <div className="flex-1 grid grid-cols-2 lg:flex lg:items-center">
                                                            {/* Start Date */}
                                                            <div className="px-3 lg:px-4 py-2 lg:py-2.5 text-center border-r border-blue-100/50">
                                                                <div className="flex items-center justify-center gap-1 text-[10px] font-medium text-blue-500 uppercase tracking-wider mb-1">
                                                                    <Play className="h-2.5 w-2.5" />
                                                                    <span>Start</span>
                                                                </div>
                                                                <div className="text-xs font-semibold text-gray-700 tabular-nums">
                                                                    {formatDate(plan.wp_start_date)}
                                                                </div>
                                                            </div>

                                                            {/* End Date */}
                                                            <div className="px-3 lg:px-4 py-2 lg:py-2.5 text-center">
                                                                <div className="flex items-center justify-center gap-1 text-[10px] font-medium text-blue-500 uppercase tracking-wider mb-1">
                                                                    <Flag className="h-2.5 w-2.5" />
                                                                    <span>End</span>
                                                                </div>
                                                                <div className="text-xs font-semibold text-gray-700 tabular-nums">
                                                                    {formatDate(plan.wp_end_date)}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* SECTION 2: Project Team Reported - Execution Status (Status-dependent colors) */}
                                                    {(() => {
                                                        // Status-based color scheme
                                                        const statusColors = {
                                                            'Completed': {
                                                                bg: 'bg-emerald-50/50',
                                                                border: 'border-emerald-200/50',
                                                                text: 'text-emerald-600',
                                                                mobileBg: 'bg-emerald-100/30',
                                                            },
                                                            'In Progress': {
                                                                bg: 'bg-amber-50/50',
                                                                border: 'border-amber-200/50',
                                                                text: 'text-amber-600',
                                                                mobileBg: 'bg-amber-100/30',
                                                            },
                                                            'Pending': {
                                                                bg: 'bg-red-50/50',
                                                                border: 'border-red-200/50',
                                                                text: 'text-red-600',
                                                                mobileBg: 'bg-red-100/30',
                                                            },
                                                            'Not Started': {
                                                                bg: 'bg-red-50/50',
                                                                border: 'border-red-200/50',
                                                                text: 'text-red-600',
                                                                mobileBg: 'bg-red-100/30',
                                                            },
                                                            'On Hold': {
                                                                bg: 'bg-gray-100/50',
                                                                border: 'border-gray-200/50',
                                                                text: 'text-gray-500',
                                                                mobileBg: 'bg-gray-100/50',
                                                            },
                                                        };
                                                        const colors = statusColors[plan.wp_status as keyof typeof statusColors] || statusColors['Pending'];

                                                        return (
                                                            <div className={`flex-1 flex flex-col lg:flex-row lg:items-center ${colors.bg}`}>
                                                                {/* Section Label - Vertical on desktop only */}
                                                                <div className={`hidden lg:block px-2 py-2.5 border-r ${colors.border}`}>
                                                                    <div className={`text-[9px] font-semibold ${colors.text} uppercase tracking-wider whitespace-nowrap [writing-mode:vertical-lr] rotate-180`}>
                                                                        Tracked
                                                                    </div>
                                                                </div>
                                                                {/* Mobile/Tablet Section Header */}
                                                                <div className={`lg:hidden w-full px-3 py-1.5 border-b ${colors.border} ${colors.mobileBg}`}>
                                                                    <span className={`text-[10px] font-semibold ${colors.text} uppercase tracking-wider`}>
                                                                        Tracked
                                                                    </span>
                                                                </div>

                                                                {/* Status, Progress, Est. Completion - Grid on mobile/tablet, Flex on desktop */}
                                                                <div className="flex-1 grid grid-cols-3 lg:flex lg:items-center">
                                                                    {/* Status */}
                                                                    <div className={`px-2 lg:px-4 py-2 lg:py-2.5 text-center border-r ${colors.border} lg:flex-1`}>
                                                                        <div className={`flex items-center justify-center gap-1 text-[9px] lg:text-[10px] font-medium ${colors.text} uppercase tracking-wider mb-1`}>
                                                                            <Activity className="h-2.5 w-2.5" />
                                                                            <span className="hidden sm:inline">Status</span>
                                                                        </div>
                                                                        <span className={`inline-flex items-center px-1.5 lg:px-2 py-0.5 text-[10px] lg:text-[11px] font-medium rounded ${
                                                                            plan.wp_status === 'Completed' ? 'bg-emerald-100 text-emerald-700' :
                                                                            plan.wp_status === 'In Progress' ? 'bg-amber-100 text-amber-700' :
                                                                            plan.wp_status === 'Pending' || plan.wp_status === 'Not Started' ? 'bg-red-100 text-red-700' :
                                                                            plan.wp_status === 'On Hold' ? 'bg-gray-200 text-gray-600' :
                                                                            'bg-red-100 text-red-700'
                                                                        }`}>
                                                                            {plan.wp_status || 'Pending'}
                                                                        </span>
                                                                    </div>

                                                                    {/* Progress */}
                                                                    <div className={`px-2 lg:px-4 py-2 lg:py-2.5 text-center border-r ${colors.border} lg:flex-1`}>
                                                                        <div className={`flex items-center justify-center gap-1 text-[9px] lg:text-[10px] font-medium ${colors.text} uppercase tracking-wider mb-1`}>
                                                                            <TrendingUp className="h-2.5 w-2.5" />
                                                                            <span className="hidden sm:inline">Progress</span>
                                                                        </div>
                                                                        <div className="flex items-center justify-center gap-1 lg:gap-2">
                                                                            <div className="w-6 lg:w-10 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                                                                <div
                                                                                    className={`h-full rounded-full ${progressNum >= 100 ? 'bg-emerald-500' :
                                                                                        progressNum >= 50 ? 'bg-amber-500' :
                                                                                            progressNum > 0 ? 'bg-sky-500' :
                                                                                                'bg-gray-300'
                                                                                        }`}
                                                                                    style={{ width: `${Math.min(progressNum, 100)}%` }}
                                                                                />
                                                                            </div>
                                                                            <span className="text-[10px] lg:text-xs font-bold text-gray-700 tabular-nums">
                                                                                {plan.wp_progress || '0'}%
                                                                            </span>
                                                                        </div>
                                                                    </div>

                                                                    {/* Est. Completion */}
                                                                    <div className="px-2 lg:px-4 py-2 lg:py-2.5 text-center lg:flex-1">
                                                                        <div className={`flex items-center justify-center gap-1 text-[9px] lg:text-[10px] font-medium ${colors.text} uppercase tracking-wider mb-1`}>
                                                                            <Target className="h-2.5 w-2.5" />
                                                                            <span className="hidden sm:inline">Est.</span>
                                                                        </div>
                                                                        <div className="text-[10px] lg:text-xs font-semibold text-gray-700 tabular-nums">
                                                                            {formatDate(plan.wp_estimate_completion_date)}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        );
                                                    })()}

                                                    {/* Actions - Neutral Section (Full width on mobile/tablet) */}
                                                    {!isOverview && (
                                                        <div className="px-3 lg:px-4 py-2 lg:py-2.5 text-center bg-gray-50 border-t lg:border-t-0 lg:border-l border-gray-200">
                                                            <div className="hidden lg:flex items-center justify-center gap-1 text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-1">
                                                                <Zap className="h-2.5 w-2.5" />
                                                                <span>Action</span>
                                                            </div>
                                                            <div className="flex items-center justify-center gap-2 lg:gap-1">
                                                                <button
                                                                    className="inline-flex items-center gap-1 px-3 lg:px-2 py-1.5 lg:py-1 text-[11px] font-medium text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors"
                                                                    onClick={() => onEditTask(plan, item)}
                                                                    title="Update Task"
                                                                >
                                                                    <Pencil className="h-3 w-3" />
                                                                    Update
                                                                </button>
                                                                {!isProjectManager && (
                                                                    <button
                                                                        className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                                                        onClick={() => onDeleteTask(plan.name)}
                                                                        title="Delete"
                                                                    >
                                                                        <Trash2 className="h-3.5 w-3.5" />
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </td>
                </tr>
            )}
            {/* Visual Separator between milestones */}
            <tr className="h-3 bg-transparent">
                <td colSpan={(isOverview || isProjectManager) ? 5 : 6} className="p-0 border-b-2 border-dashed border-gray-200/60" />
            </tr>
        </>
    );
};

export const SevendaysWorkPlan = ({
    projectId,
    startDate,
    endDate,
    isOverview,
    projectName
}: SevendaysWorkPlanProps) => {

    const { role } = useUserData();
    const isProjectManager = role === "Nirmaan Project Manager Profile";

    const [isBufferDialogOpen, setIsBufferDialogOpen] = useState(false);
    // Track which zone we are doing the buffer export for (undefined = All, string = specific zone)
    const [bufferTargetZone, setBufferTargetZone] = useState<string | undefined>(undefined);

    const [bufferDays, setBufferDays] = useState<number | string>("");
    const [addToStart, setAddToStart] = useState<boolean>(true);
    const [addToEnd, setAddToEnd] = useState<boolean>(true);
    const [isMainExpanded, _setIsMainExpanded] = useState(true);

    const { toast } = useToast();
    const { deleteDoc } = useFrappeDeleteDoc();

    const shouldFetch = projectId;
    const { data: result, error, isLoading: loading, mutate } = useFrappeGetCall<{
        message: {
            data: Record<string, WorkPlanItem[]>;
            reason: string | null;
        }
    }>(
        shouldFetch
            ? "nirmaan_stack.api.seven_days_planning.work_plan_api.get_work_plan"
            : null,
        shouldFetch
            ? {
                project: projectId,
                start_date: startDate ? format(startDate, "yyyy-MM-dd") : undefined,
                end_date: endDate ? format(endDate, "yyyy-MM-dd") : undefined,
            }
            : undefined
    );


    const { data: projectDoc } = useFrappeGetDoc("Projects", projectId);
    const zones: string[] = useMemo(() => {
        if (!projectDoc?.project_zones) return [];
        return projectDoc.project_zones.map((z: any) => z.zone_name).sort();
    }, [projectDoc]);

    const zoneCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        if (result?.message?.data) {
            Object.values(result.message.data).forEach((items) => {
                items.forEach((item) => {
                    const zone = item.zone;
                    const count = item.work_plan_doc?.length || 0;
                    if (count > 0 && zone) {
                        counts[zone] = (counts[zone] || 0) + count;
                    }
                });
            });
        }
        return counts;
    }, [result]);

    const urlZone = useUrlParam("planningZone");

    // Derived state from URL or fallback
    const [activeZone, setActiveZone] = useState<string>("");

    // Effect to sync local state with URL and handle defaults
    useEffect(() => {
        if (zones.length > 0) {
            // If URL has valid zone, use it
            if (urlZone && zones.includes(urlZone)) {
                setActiveZone(urlZone);
            }
            // If URL has no zone or invalid zone, default to first zone and update URL
            else if (!urlZone || !zones.includes(urlZone)) {
                const defaultZone = zones[0];
                setActiveZone(defaultZone);
                if (urlZone !== defaultZone) {
                    urlStateManager.updateParam("planningZone", defaultZone);
                }
            }
        }
    }, [zones, urlZone]);

    const handleZoneChange = (zone: string) => {
        setActiveZone(zone);
        urlStateManager.updateParam("planningZone", zone);
    };

    const [expandedHeaders, setExpandedHeaders] = useState<Record<string, boolean>>({});

    const toggleHeader = (header: string) => {
        setExpandedHeaders((prev) => ({
            ...prev,
            [header]: prev[header] === false ? true : false,
        }));
    };

    const [editMilestoneState, setEditMilestoneState] = useState<{
        isOpen: boolean;
        item: WorkPlanItem | null;
    }>({
        isOpen: false,
        item: null,
    });

    const [createTaskState, setCreateTaskState] = useState<{
        isOpen: boolean;
        data: {
            project: string;
            zone: string;
            work_header: string;
            work_milestone: string;
        } | null;
        docName?: string;
        initialData?: {
            wp_title: string;
            wp_status: string;
            wp_start_date: string;
            wp_end_date: string;
            wp_description: string;
        };
    }>({
        isOpen: false,
        data: null,
    });

    const [pmEditDialogState, setPmEditDialogState] = useState<{
        isOpen: boolean;
        docName: string;
        initialData: {
            wp_title: string;
            wp_status: string;
            wp_start_date: string;
            wp_end_date: string;
            wp_description: string;
            wp_progress?: number;
            wp_estimate_completion_date?: string;
        } | null;
    }>({
        isOpen: false,
        docName: "",
        initialData: null,
    });

    const [deleteDialogState, setDeleteDialogState] = useState<{
        isOpen: boolean;
        planName: string | null;
    }>({
        isOpen: false,
        planName: null,
    });

    const handleAddTask = (item: WorkPlanItem) => {
        setCreateTaskState({
            isOpen: true,
            data: {
                project: projectId, // specific field name from props
                zone: item.zone,
                work_header: item.work_header,
                work_milestone: item.work_milestone_name,
            },
            docName: undefined,
            initialData: undefined
        });
    };

    const handleEditTask = (plan: WorkPlanDoc, item: WorkPlanItem) => {
        if (isProjectManager) {
            setPmEditDialogState({
                isOpen: true,
                docName: plan.name,
                initialData: {
                    wp_title: plan.wp_title,
                    wp_status: plan.wp_status,
                    wp_start_date: plan.wp_start_date,
                    wp_end_date: plan.wp_end_date,
                    wp_description: plan.wp_description,
                    wp_progress: plan.wp_progress ? parseFloat(plan.wp_progress) : 0,
                    wp_estimate_completion_date: plan.wp_estimate_completion_date
                }
            });
        } else {
            setCreateTaskState({
                isOpen: true,
                data: {
                    project: projectId,
                    zone: item.zone,
                    work_header: item.work_header,
                    work_milestone: item.work_milestone_name,
                },
                docName: plan.name,
                initialData: {
                    wp_title: plan.wp_title,
                    wp_status: plan.wp_status,
                    wp_start_date: plan.wp_start_date,
                    wp_end_date: plan.wp_end_date,
                    wp_description: plan.wp_description
                }
            });
        }
    };

    const handleDeleteTask = (planName: string) => {
        setDeleteDialogState({
            isOpen: true,
            planName: planName,
        });
    };

    const handleEditMilestone = (item: WorkPlanItem) => {
        setEditMilestoneState({
            isOpen: true,
            item: item,
        });
    };

    const confirmDelete = async () => {
        const planName = deleteDialogState.planName;
        if (planName) {
            try {
                await deleteDoc("Work Plan", planName);
                toast({
                    title: "Success",
                    description: "Task deleted successfully",
                    variant: "success",
                });
                mutate();
            } catch (error: any) {
                toast({
                    title: "Error",
                    description: error.message || "Failed to delete task",
                    variant: "destructive",
                });
            } finally {
                setDeleteDialogState({ isOpen: false, planName: null });
            }
        }
    };

    const [isDownloading, setIsDownloading] = useState(false);
    const [isBufferDownloading, setIsBufferDownloading] = useState(false);

    // Refactored download logic to accept dates
    const performDownload = async (downloadStartDate: Date | undefined, downloadEndDate: Date | undefined, zone: string | undefined) => {
        setIsDownloading(true);
        try {
            const formatName = "Project Work Plan";

            const params = new URLSearchParams({
                doctype: "Projects",
                name: projectId,
                format: formatName,
                no_letterhead: "0",
                _lang: "en",
            });

            if (downloadStartDate) {
                params.append("start_date", format(downloadStartDate, "yyyy-MM-dd"));
            }
            if (downloadEndDate) {
                params.append("end_date", format(downloadEndDate, "yyyy-MM-dd"));
            }
            // Passing undefined or "All" to zone will export all zones (controlled by print format logic)
            if (zone && zone !== "All") {
                params.append("zone", zone);
            }

            const url = `/api/method/frappe.utils.print_format.download_pdf?${params.toString()}`;

            const response = await fetch(url);
            if (!response.ok) throw new Error("Network response was not ok");

            const blob = await response.blob();
            const downloadUrl = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = downloadUrl;

            const safeProjectName = (projectName || projectId).replace(/ /g, "_");
            const zoneSuffix = (zone && zone !== "All") ? `_${zone.replace(/ /g, "_")}` : "_All_Zones";
            link.download = `WorkPlan_${safeProjectName}${zoneSuffix}_${format(new Date(), "dd-MMM-yyyy")}.pdf`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(downloadUrl);
        } catch (error) {
            console.error("Download failed:", error);
            toast({
                title: "Download Failed",
                description: "Could not download the Work Plan PDF. Please check if the Print Format exists.",
                variant: "destructive",
            });
        } finally {
            setIsDownloading(false);
        }
    };

    const handleDownloadAll = (e: React.MouseEvent) => {
        e.stopPropagation();
        // Export ALL zones
        performDownload(startDate, endDate, undefined);
    };

    const handleDownloadZone = (e: React.MouseEvent) => {
        e.stopPropagation();
        // Export ACTIVE zone
        performDownload(startDate, endDate, activeZone);
    };

    const openBufferDialog = (e: React.MouseEvent, zone: string | undefined) => {
        e.stopPropagation();
        setBufferTargetZone(zone); // Store which zone (or All) we are exporting
        setBufferDays("");
        setAddToStart(true);
        setAddToEnd(true);
        setIsBufferDialogOpen(true);
    };

    const handleBufferDownload = async (start: Date | undefined, end: Date | undefined, days: number | string, toStart: boolean, toEnd: boolean) => {
        setIsBufferDownloading(true);
        try {
            const formatName = "Project Work Plan Buffered";

            const params = new URLSearchParams({
                doctype: "Projects",
                name: projectId,
                format: formatName,
                no_letterhead: "0",
                _lang: "en",
            });

            if (start) params.append("start_date", format(start, "yyyy-MM-dd"));
            if (end) params.append("end_date", format(end, "yyyy-MM-dd"));

            // Use the stored target zone (from when dialog was opened)
            if (bufferTargetZone && bufferTargetZone !== "All") {
                params.append("zone", bufferTargetZone);
            }

            // Pass extra parameters for the buffered print format
            params.append("buffer_days", String(days));
            params.append("add_to_start", String(toStart));
            params.append("add_to_end", String(toEnd));

            const url = `/api/method/frappe.utils.print_format.download_pdf?${params.toString()}`;

            const response = await fetch(url);
            if (!response.ok) throw new Error("Network response was not ok");

            const blob = await response.blob();
            const downloadUrl = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = downloadUrl;

            const safeProjectName = (projectName || projectId).replace(/ /g, "_");
            const zoneSuffix = (bufferTargetZone && bufferTargetZone !== "All") ? `_${bufferTargetZone.replace(/ /g, "_")}` : "_All_Zones";
            link.download = `WorkPlan_${safeProjectName}${zoneSuffix}_${format(new Date(), "dd-MMM-yyyy")}.pdf`;

            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(downloadUrl);
        } catch (error) {
            console.error("Buffer download failed:", error);
            toast({
                title: "Download Failed",
                description: "Could not download the Buffer Work Plan PDF.",
                variant: "destructive",
            });
        } finally {
            setIsBufferDownloading(false);
            setIsBufferDialogOpen(false);
        }
    }

    const closeCreateTask = () => {
        setCreateTaskState((prev) => ({ ...prev, isOpen: false }));
    };

    if (loading) {
        return (
            <div className="flex h-40 w-full items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <span className="ml-2 text-sm text-gray-500">Loading work plan...</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="rounded-md bg-red-50 p-4 text-sm text-red-500">
                <div className="flex items-center font-medium">
                    <AlertCircle className="mr-2 h-4 w-4" />
                    Error loading work plan
                </div>
                <div className="mt-1 pl-6">{error.message}</div>
            </div>
        );
    }

    let workHeaders = result?.message?.data ? Object.keys(result.message.data) : [];

    // Filter headers if isOverview is true OR if user is Project Manager
    if ((isOverview || isProjectManager) && result?.message?.data) {
        workHeaders = workHeaders.filter(header => {
            const items = result.message.data[header];
            // Keep header only if it has at least one item with planned activities
            return items?.some(item => item.work_plan_doc && item.work_plan_doc.length > 0);
        });
    }

    const hasData = workHeaders.length > 0;

    // For Project Managers, check if the selected zone has any plan activities
    let hasZoneData = hasData;
    if (isProjectManager && result?.message?.data && activeZone) {
        hasZoneData = workHeaders.some(header => {
            const items = result.message.data[header];
            return items?.some(item =>
                item.zone === activeZone &&
                item.work_plan_doc &&
                item.work_plan_doc.length > 0
            );
        });
    }

    let totalPlannedActivities = 0;
    if (result?.message?.data) {
        Object.values(result.message.data).forEach((items) => {
            const filteredItems = activeZone
                ? items.filter(item => item.zone === activeZone)
                : items;

            filteredItems.forEach((item) => {
                totalPlannedActivities += item.work_plan_doc?.length || 0;
            });
        });
    }

    return (
        <div className="space-y-4 md:space-y-6">
            <div className="overflow-hidden bg-white">
                {
                    <div
                        className="flex flex-col sm:flex-row sm:items-center justify-between bg-white py-2 gap-3"
                    >
                        <div className="flex items-center gap-3">
                            <h3 className="text-lg sm:text-xl font-bold text-gray-900">Work Plan</h3>
                        </div>
                        {/* GLOBAL EXPORT BUTTONS (ALL ZONES) */}
                        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
                            <Button
                                variant="outline"
                                size="sm"
                                className="gap-1.5 sm:gap-2 h-7 sm:h-8 text-[10px] sm:text-xs border-gray-300 text-gray-700 whitespace-nowrap flex-shrink-0"
                                onClick={(e) => openBufferDialog(e, undefined)}
                                disabled={isDownloading}
                                title="Export Buffered plan for ALL zones"
                            >
                                <Download className="h-3 sm:h-3.5 w-3 sm:w-3.5" />
                                <span className="hidden xs:inline">Buffer</span> Export (All)
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                className="gap-1.5 sm:gap-2 h-7 sm:h-8 text-[10px] sm:text-xs border-gray-300 text-gray-700 whitespace-nowrap flex-shrink-0"
                                onClick={handleDownloadAll}
                                disabled={isDownloading}
                                title="Export plan for ALL zones"
                            >
                                {isDownloading ? (
                                    <Loader2 className="h-3 sm:h-3.5 w-3 sm:w-3.5 animate-spin" />
                                ) : (
                                    <Download className="h-3 sm:h-3.5 w-3 sm:w-3.5" />
                                )}
                                Export (All)
                            </Button>
                        </div>
                    </div>
                }
            </div>

            {zones.length > 0 && (
                <div className="border border-gray-200 rounded bg-white mb-4">
                    {/* Zone Tabs - Horizontal scroll on mobile, wrap on larger screens */}
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 sm:py-3 border-b border-gray-100">
                        <span className="text-[10px] sm:text-xs font-medium text-gray-500 uppercase tracking-wide flex-shrink-0">
                            Zone
                        </span>
                        {/* Horizontal scroll container on mobile */}
                        <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 scrollbar-thin">
                            <div className="flex gap-1.5 sm:flex-wrap pb-1 sm:pb-0">
                                {zones.filter(zone => (zoneCounts[zone] || 0) > 0).map((zone) => (
                                    <button
                                        key={zone}
                                        type="button"
                                        onClick={() => handleZoneChange(zone)}
                                        className={`px-2.5 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm rounded transition-colors flex items-center gap-1.5 sm:gap-2 whitespace-nowrap flex-shrink-0 ${activeZone === zone
                                            ? "bg-sky-500 text-white"
                                            : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                            }`}
                                    >
                                        {zone}
                                        <span className={`flex h-4 w-4 sm:h-5 sm:w-5 items-center justify-center rounded-full text-[9px] sm:text-[10px] font-medium ${activeZone === zone
                                            ? "bg-white text-sky-600"
                                            : "bg-white text-gray-600"
                                            }`}>
                                            {zoneCounts[zone]}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Zone-specific Export Buttons */}
                    <div className="flex items-center justify-end gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 bg-gray-50/50 rounded-b">
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-[9px] sm:text-[10px] text-gray-600 gap-1 sm:gap-1.5 px-2 border-gray-300"
                            onClick={(e) => openBufferDialog(e, activeZone)}
                            disabled={isDownloading}
                            title={`Buffer Export ${activeZone}`}
                        >
                            <Download className="h-3 w-3" />
                            <span className="hidden xs:inline">Buffer</span> Export
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-[9px] sm:text-[10px] text-gray-600 hover:text-blue-600 gap-1 sm:gap-1.5 px-2"
                            onClick={handleDownloadZone}
                            disabled={isDownloading}
                            title={`Export ${activeZone} data`}
                        >
                            {isDownloading ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                                <Download className="h-3 w-3" />
                            )}
                            Export
                        </Button>
                    </div>
                </div>
            )}

            {isMainExpanded && (
                <div className="p-2 space-y-4">
                    {/* Show different empty states based on role and zone */}
                    {isProjectManager && !hasZoneData ? (
                        <div className="rounded-lg border bg-blue-50 p-8 text-center text-gray-600">
                            <div className="text-lg font-medium mb-1">No Plan Activities</div>
                            <div className="text-sm">There are no planned activities available in <span className="font-semibold">{activeZone}</span> zone.</div>
                        </div>
                    ) : !hasData ? (
                        <div className="rounded-lg border bg-gray-50 p-8 text-center text-gray-500">
                            {result?.message?.reason || "No work plan items found."}
                        </div>
                    ) : (
                        workHeaders.map((header) => {
                            let items = result?.message?.data[header] || [];

                            // Filter to only show milestones with plan activities for overview or PM
                            if (isOverview || isProjectManager) {
                                items = items.filter(item => item.work_plan_doc && item.work_plan_doc.length > 0);
                            }

                            // Strict Filtering: Since we removed the "All" tab, activeZone should usually be set.
                            // If for some reason activeZone is empty, this logic implies showing everything (fallback),
                            // but the UI tabs enforce a selection.
                            if (activeZone) {
                                items = items.filter(item => item.zone === activeZone);
                            }

                            if (items.length === 0) return null;

                            const totalWeightage = items.reduce((sum, item) => sum + (item.weightage || 1.0), 0);
                            const totalWeightedProgress = items.reduce((sum, item) => sum + ((item.progress || 0) * (item.weightage || 1.0)), 0);

                            const avgProgress = totalWeightage > 0
                                ? Math.round(totalWeightedProgress / totalWeightage)
                                : 0;

                            const plannedActivitiesCount = items.reduce((acc, item) => acc + (item.work_plan_doc?.length || 0), 0);
                            const isExpanded = expandedHeaders[header] !== false;

                            if (isOverview) {
                                return (
                                    <WorkPlanOverview
                                        key={header}
                                        header={header}
                                        items={items}
                                        getHeaderStats={() => ({ avgProgress, plannedActivitiesCount })}
                                        isProjectManager={isProjectManager}
                                    />
                                );
                            }

                            return (
                                <div key={header} className="overflow-hidden bg-white">
                                    {/* Work Header Row - Collapsible */}
                                    <div
                                        className={`flex cursor-pointer flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3 ${isExpanded ? "" : "border bg-gray-100/50 px-3 py-3 rounded-md"} py-2 sm:py-3 transition-colors`}
                                        onClick={() => toggleHeader(header)}
                                    >
                                        <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
                                            <h4 className="font-bold text-gray-900 text-sm sm:text-base line-clamp-2 sm:line-clamp-none">{header}</h4>
                                            {/* Milestone count with border */}
                                            <span className="rounded border border-gray-400 bg-gray-50 px-2 py-0.5 text-[10px] sm:text-xs font-medium text-gray-700 whitespace-nowrap">
                                                {items.length} Milestones
                                            </span>
                                            {/* Planned Activities badge */}
                                            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] sm:text-xs font-medium text-blue-700 border border-blue-300 whitespace-nowrap">
                                                {plannedActivitiesCount} Planned Activities
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-end w-full sm:w-auto">
                                            <div className={`flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center ${isExpanded ? "" : "bg-blue-100 rounded border border-gray-200 shadow-sm"}`}>
                                                {isExpanded ? (
                                                    <ChevronUp className="h-4 w-4 text-gray-500" />
                                                ) : (
                                                    <ChevronDown className="h-4 w-4 text-gray-500" />
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    {isExpanded && (
                                        <div className="rounded-lg border bg-white shadow-sm mt-2 mx-0 sm:mx-2 border-[#D7D7EC]">
                                            <div className="p-0">
                                                <table className="w-full text-left text-sm">
                                                    {/* Table Header - Hidden on mobile/tablet, shown on desktop (lg+) */}
                                                    <thead className="bg-gray-100/50 hidden lg:table-header-group">
                                                        <tr>
                                                            <th className="px-4 py-3 font-semibold text-gray-900 w-[300px]">Work</th>
                                                            <th className="px-4 py-3 font-semibold text-gray-900 w-[140px] text-center">Status</th>
                                                            <th className="px-4 py-3 font-semibold text-gray-900 w-[100px] text-center">Progress</th>
                                                            <th className="px-4 py-3 font-semibold text-gray-900 w-[120px] text-center">Start Date</th>
                                                            <th className="px-4 py-3 font-semibold text-gray-900 w-[120px] text-center">End Date</th>
                                                            {!isOverview && !isProjectManager && (
                                                                <th className="px-4 py-3 font-semibold text-gray-900 w-[140px]">Admin Actions</th>
                                                            )}
                                                        </tr>
                                                    </thead>
                                                    {/* Mobile/Tablet: Cards layout via MilestoneCard | Desktop (lg+): Table rows */}
                                                    <tbody className="divide-y divide-gray-100 lg:divide-y-0">
                                                        {items.map((item, idx) => (
                                                            <MilestoneRow
                                                                key={idx}
                                                                item={item}
                                                                onAddTask={handleAddTask}
                                                                onEditTask={handleEditTask}
                                                                onDeleteTask={handleDeleteTask}
                                                                onEditMilestone={handleEditMilestone}
                                                                isOverview={isOverview}
                                                                isProjectManager={isProjectManager}
                                                            />
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            )}

            {/* Dialogs and Modals */}
            {createTaskState.isOpen && createTaskState.data && (
                <CreateWorkplantask
                    isOpen={createTaskState.isOpen}
                    onClose={closeCreateTask}
                    onSuccess={() => {
                        mutate();
                    }}
                    defaultValues={createTaskState.data}
                    docName={createTaskState.docName}
                    initialData={createTaskState.initialData}
                />
            )}

            {pmEditDialogState.isOpen && pmEditDialogState.initialData && (
                <ProjectManagerEditWorkPlanDialog
                    isOpen={pmEditDialogState.isOpen}
                    onClose={() => setPmEditDialogState(prev => ({ ...prev, isOpen: false }))}
                    onSuccess={() => mutate()}
                    docName={pmEditDialogState.docName}
                    initialData={pmEditDialogState.initialData}
                />
            )}

            {editMilestoneState.isOpen && (
                <EditMilestoneDialog
                    isOpen={editMilestoneState.isOpen}
                    onClose={() => setEditMilestoneState({ isOpen: false, item: null })}
                    item={editMilestoneState.item}
                    onSuccess={() => mutate()}
                />
            )}

            {/* Buffer Export Dialog */}
            <Dialog open={isBufferDialogOpen} onOpenChange={setIsBufferDialogOpen}>
                <DialogContent className="sm:max-w-[425px] p-0 overflow-hidden">
                    <DialogHeader className="px-6 pt-6 pb-4 border-b bg-gray-50/50">
                        <DialogTitle className="text-xl font-bold text-gray-900 leading-none">
                            Client Version Export
                            {bufferTargetZone ? ` (${bufferTargetZone === "All" ? "All Zones" : bufferTargetZone})` : ""}
                        </DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-6 px-6 py-6">
                        <div className="grid grid-cols-[auto_1fr] items-center gap-4 pt-1">
                            <Label htmlFor="bufferDays" className="font-semibold whitespace-nowrap">Add Buffer Days:</Label>
                            <Input
                                id="bufferDays"
                                type="number"
                                value={bufferDays}
                                onChange={(e) => setBufferDays(e.target.value === "" ? "" : Number(e.target.value))}
                                className="w-full h-9"
                                placeholder="Enter days"
                            />
                        </div>
                        <div className="flex gap-6">
                            <div className="flex items-center space-x-2">
                                <Checkbox
                                    id="addToStart"
                                    checked={addToStart}
                                    onCheckedChange={(checked) => setAddToStart(checked as boolean)}
                                />
                                <Label htmlFor="addToStart" className="text-sm font-medium cursor-pointer">
                                    Add to Start Date
                                </Label>
                            </div>
                            <div className="flex items-center space-x-2">
                                <Checkbox
                                    id="addToEnd"
                                    checked={addToEnd}
                                    onCheckedChange={(checked) => setAddToEnd(checked as boolean)}
                                />
                                <Label htmlFor="addToEnd" className="text-sm font-medium cursor-pointer">
                                    Add to End Date
                                </Label>
                            </div>
                        </div>
                    </div>
                    <DialogFooter className="px-6 py-4 border-t bg-gray-50/50 flex items-center justify-end gap-3">
                        <Button
                            variant="outline"
                            onClick={() => setIsBufferDialogOpen(false)}
                            disabled={isBufferDownloading}
                            className="h-9 px-4 text-sm font-medium border-gray-300 hover:bg-gray-100 transition-colors"
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={() => handleBufferDownload(startDate, endDate, bufferDays, addToStart, addToEnd)}
                            disabled={(!addToStart && !addToEnd) || isBufferDownloading || bufferDays === ""}
                            className="h-9 px-4 text-sm font-medium transition-all"
                        >
                            {isBufferDownloading ? (
                                <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Exporting...</>
                            ) : (
                                "Confirm"
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AlertDialog open={deleteDialogState.isOpen} onOpenChange={(open) => setDeleteDialogState(prev => ({ ...prev, isOpen: open }))}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This action cannot be undone. This will permanently delete the task.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};