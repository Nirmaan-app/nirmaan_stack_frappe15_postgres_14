import React, { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ProgressCircle } from "@/components/ui/ProgressCircle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowUpRight, CheckCircle2, Eye, EyeOff, User } from "lucide-react";
import { getUnifiedStatusStyle } from "../utils";

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
    const statusCounts = tracker.status_counts || {};
    const totalTasks = tracker.total_tasks || 0;
    const completedTasks = tracker.completed_tasks || 0;
    const completionPercentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

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

    // Calculate tasks assigned to current user (only for designers)
    const myAssignedTasksCount = useMemo(() => {
        if (!isDesigner || !currentUserId || !tracker.design_tracker_task) return 0;

        return tracker.design_tracker_task.filter((task: any) => {
            const designerField = task.assigned_designers;
            if (!designerField) return false;

            let designers: { userId: string }[] = [];

            // Parse assigned_designers (same logic as utils.tsx)
            if (typeof designerField === 'object' && designerField !== null && 'list' in designerField) {
                designers = designerField.list;
            } else if (Array.isArray(designerField)) {
                designers = designerField;
            } else if (typeof designerField === 'string' && designerField.trim() !== '') {
                try {
                    const parsed = JSON.parse(designerField);
                    if (parsed && Array.isArray(parsed.list)) {
                        designers = parsed.list;
                    } else if (Array.isArray(parsed)) {
                        designers = parsed;
                    }
                } catch (e) { /* silent */ }
            }

            return designers.some(d => d.userId === currentUserId);
        }).length;
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
                        <CardTitle
                            className="text-base font-semibold text-gray-900 line-clamp-2 leading-snug"
                            title={tracker.project_name}
                        >
                            {tracker.project_name}
                        </CardTitle>
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
                </div>

                {/* My Assigned Tasks - Only for designers with assigned tasks */}
                {isDesigner && myAssignedTasksCount > 0 && (
                    <div className="flex items-center gap-1.5 mb-3 px-2 py-1.5 bg-blue-50 rounded-md border border-blue-100">
                        <User className="h-3 w-3 text-blue-600" />
                        <span className="text-xs text-blue-700 font-medium">
                            {myAssignedTasksCount} {myAssignedTasksCount === 1 ? 'task' : 'tasks'} assigned to you
                        </span>
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
