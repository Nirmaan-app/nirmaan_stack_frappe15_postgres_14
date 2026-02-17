import React, { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ProgressCircle } from "@/components/ui/ProgressCircle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowUpRight, CheckCircle2, Eye, EyeOff, User } from "lucide-react";
import { getUnifiedStatusStyle, parseDesignersFromField } from "../utils";

interface ProjectWiseCardProps {
    tracker: any;
    onClick?: () => void;
    showHiddenBadge?: boolean;
    onHideToggle?: (trackerId: string, newHiddenState: boolean) => void;
    // For "assigned to me" feature
    currentUserId?: string;
    isDesigner?: boolean;
}

export const ProjectWiseCard: React.FC<ProjectWiseCardProps> = ({ tracker, onClick, showHiddenBadge, onHideToggle, currentUserId, isDesigner }) => {
    const isHidden = tracker.hide_design_tracker === 1;
    const hasHandover = tracker.handover_generated === 1;
    const statusCounts = tracker.status_counts || {};
    const totalTasks = tracker.total_tasks || 0;
    const completedTasks = tracker.completed_tasks || 0;
    const completionPercentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    // Compute phase-specific stats when handover exists
    const phaseStats = useMemo(() => {
        if (!hasHandover || !tracker.design_tracker_task) return null;

        const tasks: any[] = tracker.design_tracker_task;
        const onboarding = { total: 0, approved: 0 };
        const handover = { total: 0, approved: 0 };

        tasks.forEach((task: any) => {
            if (task.task_status === 'Not Applicable') return;
            if (task.task_phase === 'Handover') {
                handover.total++;
                if (task.task_status === 'Approved') handover.approved++;
            } else {
                // Default to Onboarding if task_phase is missing or "Onboarding"
                onboarding.total++;
                if (task.task_status === 'Approved') onboarding.approved++;
            }
        });

        return { onboarding, handover };
    }, [hasHandover, tracker.design_tracker_task]);

    // Determine color based on completion percentage
    const getProgressColor = (percentage: number): string => {
        if (percentage === 100) return 'text-green-600';
        if (percentage >= 76) return 'text-green-600';
        if (percentage >= 26) return 'text-yellow-500';
        return 'text-red-600';
    };

    const progressColor = getProgressColor(completionPercentage);

    // Check completion status
    const isAllApproved = completedTasks === totalTasks && totalTasks > 0;

    // Filter out "Approved" status since it's shown as the primary metric
    // Also filter out "Not Applicable" as it's typically excluded from active tracking
    const incompleteStatusEntries = Object.entries(statusCounts)
        .filter(([status]) => status !== "Approved" && status !== "Not Applicable")
        .filter(([, count]) => (count as number) > 0);

    const hasIncompleteWork = incompleteStatusEntries.length > 0;

    // All status entries for data mismatch fallback
    const allStatusEntries = Object.entries(statusCounts)
        .filter(([, count]) => (count as number) > 0);

    // Calculate tasks assigned to current user with phase breakdown (only for designers)
    const myAssignedTasks = useMemo(() => {
        if (!isDesigner || !currentUserId || !tracker.design_tracker_task) {
            return { onboarding: 0, handover: 0, total: 0 };
        }

        let onboarding = 0;
        let handover = 0;

        tracker.design_tracker_task.forEach((task: any) => {
            const designers = parseDesignersFromField(task.assigned_designers);
            if (!designers.some(d => d.userId === currentUserId)) return;
            if (task.task_phase === 'Handover') handover++;
            else onboarding++;
        });

        return { onboarding, handover, total: onboarding + handover };
    }, [tracker.design_tracker_task, currentUserId, isDesigner]);

    return (
        <Card
            className={`
                group h-full flex flex-col
                border bg-white
                transition-all duration-200
                hover:shadow-md hover:border-primary/40
                cursor-pointer
                ${isHidden && showHiddenBadge ? 'border-orange-300 bg-orange-50/30' : 'border-gray-200'}
            `}
            onClick={onClick}
        >
            <CardHeader className="pb-3 space-y-0">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 flex flex-col gap-1">
                        {/* Hidden Badge */}
                        {showHiddenBadge && isHidden && (
                            <Badge
                                variant="outline"
                                className="text-[10px] px-1.5 py-0 w-fit bg-orange-100 text-orange-700 border-orange-300"
                            >
                                <EyeOff className="h-2.5 w-2.5 mr-1" />
                                Hidden
                            </Badge>
                        )}
                        <div className="flex items-center gap-1.5">
                            <CardTitle
                                className="text-base font-semibold text-gray-900 line-clamp-2 leading-snug"
                                title={tracker.project_name}
                            >
                                {tracker.project_name}
                            </CardTitle>
                            {hasHandover && (
                                <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-[10px] shrink-0">
                                    Handover
                                </Badge>
                            )}
                        </div>
                    </div>

                    {/* Progress Circle - Single indicator with color-coded progress */}
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
                    {phaseStats ? (
                        <>
                            {/* Handover phase as primary metric */}
                            <div className="flex items-center gap-1.5 mb-1">
                                <CheckCircle2 className="h-3.5 w-3.5 text-blue-600" />
                                <span className="text-xs text-gray-500">Handover Approved</span>
                            </div>
                            <div className="flex items-baseline gap-1">
                                <span className={`text-2xl font-bold tabular-nums ${
                                    phaseStats.handover.total > 0
                                        ? getProgressColor(Math.round((phaseStats.handover.approved / phaseStats.handover.total) * 100))
                                        : 'text-gray-400'
                                }`}>
                                    {phaseStats.handover.approved}
                                </span>
                                <span className="text-lg text-gray-400 font-medium">/</span>
                                <span className="text-lg text-gray-500 font-semibold tabular-nums">
                                    {phaseStats.handover.total}
                                </span>
                            </div>
                            {/* Onboarding phase as secondary line */}
                            <div className="flex items-center gap-1.5 mt-1.5 text-xs text-gray-500">
                                <CheckCircle2 className="h-3 w-3 text-green-500" />
                                <span>Onboarding: {phaseStats.onboarding.approved}/{phaseStats.onboarding.total} Approved</span>
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="flex items-center gap-1.5 mb-1">
                                <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                                <span className="text-xs text-gray-500">Drawings Approved</span>
                            </div>
                            <div className="flex items-baseline gap-1">
                                <span className={`text-2xl font-bold tabular-nums ${progressColor}`}>
                                    {completedTasks}
                                </span>
                                <span className="text-lg text-gray-400 font-medium">/</span>
                                <span className="text-lg text-gray-500 font-semibold tabular-nums">
                                    {totalTasks}
                                </span>
                            </div>
                        </>
                    )}
                </div>

                {/* My Assigned Tasks - Only for designers with assigned tasks */}
                {isDesigner && myAssignedTasks.total > 0 && (
                    <div className="mb-3 px-2 py-1.5 bg-blue-50 rounded-md border border-blue-100">
                        <div className="flex items-center gap-1.5">
                            <User className="h-3 w-3 text-blue-600 shrink-0" />
                            <span className="text-xs text-blue-700 font-medium">
                                {myAssignedTasks.total} {myAssignedTasks.total === 1 ? 'task' : 'tasks'} assigned to you
                            </span>
                        </div>
                        {/* Phase breakdown — only when this tracker has handover */}
                        {hasHandover && (
                            <div className="flex items-center gap-3 pl-[18px] mt-0.5 text-[11px]">
                                <span className="text-green-700">
                                    Onboarding: <span className="font-semibold">{myAssignedTasks.onboarding}</span>
                                </span>
                                <span className="text-blue-700">
                                    Handover: <span className="font-semibold">{myAssignedTasks.handover}</span>
                                </span>
                            </div>
                        )}
                    </div>
                )}

                {/* Status Breakdown */}
                {totalTasks > 0 ? (
                    <div className="flex-1">
                        {hasIncompleteWork ? (
                            // Show only incomplete statuses (exclude Approved and Not Applicable)
                            <div className="grid grid-cols-2 gap-2">
                                {incompleteStatusEntries.map(([status, count]) => (
                                    <TooltipProvider key={status}>
                                        <Tooltip delayDuration={300}>
                                            <TooltipTrigger asChild>
                                                <div
                                                    className={`
                                                        flex items-center justify-between px-2.5 py-1.5 rounded-md
                                                        ${getUnifiedStatusStyle(status)}
                                                        cursor-default
                                                    `}
                                                >
                                                    <span className="text-[11px] font-medium truncate pr-1">
                                                        {status}
                                                    </span>
                                                    <span className="text-xs font-bold tabular-nums">
                                                        {count as number}
                                                    </span>
                                                </div>
                                            </TooltipTrigger>
                                            <TooltipContent side="top" className="text-xs">
                                                {status}: {count as number} {(count as number) === 1 ? 'task' : 'tasks'}
                                            </TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                ))}
                            </div>
                        ) : isAllApproved ? (
                            // All drawings are approved
                            <div className="flex items-center justify-center py-2 px-3 rounded-md bg-green-50 text-green-700">
                                <span className="text-xs font-medium">All drawings approved!</span>
                            </div>
                        ) : allStatusEntries.length > 0 ? (
                            // Data mismatch - show all available statuses
                            <div className="grid grid-cols-2 gap-2">
                                {allStatusEntries.map(([status, count]) => (
                                    <TooltipProvider key={status}>
                                        <Tooltip delayDuration={300}>
                                            <TooltipTrigger asChild>
                                                <div
                                                    className={`
                                                        flex items-center justify-between px-2.5 py-1.5 rounded-md
                                                        ${getUnifiedStatusStyle(status)}
                                                        cursor-default
                                                    `}
                                                >
                                                    <span className="text-[11px] font-medium truncate pr-1">
                                                        {status}
                                                    </span>
                                                    <span className="text-xs font-bold tabular-nums">
                                                        {count as number}
                                                    </span>
                                                </div>
                                            </TooltipTrigger>
                                            <TooltipContent side="top" className="text-xs">
                                                {status}: {count as number} {(count as number) === 1 ? 'task' : 'tasks'}
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

                {/* Footer: Hide Toggle + View Details Link */}
                <div className="mt-3 pt-3 border-t border-gray-100">
                    <div className="flex items-center justify-between">
                        {/* Hide/Unhide Button - Only shown when onHideToggle is provided */}
                        {onHideToggle ? (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 text-[10px] px-2 gap-1 text-gray-500 hover:text-orange-600"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onHideToggle(tracker.name, !isHidden);
                                }}
                            >
                                {isHidden ? (
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
                            <div /> /* Empty div to maintain flex spacing */
                        )}

                        {/* View Details Link */}
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
