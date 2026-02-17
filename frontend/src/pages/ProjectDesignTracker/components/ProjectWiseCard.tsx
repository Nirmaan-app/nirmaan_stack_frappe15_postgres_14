import React, { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ProgressCircle } from "@/components/ui/ProgressCircle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowUpRight, CheckCircle2, Eye, EyeOff, User } from "lucide-react";
import { getUnifiedStatusStyle, parseDesignersFromField } from "../utils";

// --- Phase Status Section (compact, left-border accent) ---
const PhaseStatusSection: React.FC<{
    label: string;
    data: { approved: number; total: number; statuses: Record<string, number> };
    colorScheme: 'green' | 'blue';
}> = ({ label, data, colorScheme }) => {
    if (data.total === 0) return null;
    const allApproved = data.approved === data.total;
    const pendingStatuses = Object.entries(data.statuses)
        .filter(([s]) => s !== 'Approved' && s !== 'Not Applicable')
        .filter(([, c]) => c > 0);

    const c = colorScheme === 'green'
        ? { border: 'border-l-green-400', bg: 'bg-green-50/40', label: 'text-green-700', count: 'text-green-700', check: 'text-green-500', done: 'text-green-600' }
        : { border: 'border-l-blue-400', bg: 'bg-blue-50/40', label: 'text-blue-700', count: 'text-blue-700', check: 'text-blue-500', done: 'text-blue-600' };

    return (
        <div className={`border-l-2 ${c.border} ${c.bg} rounded-r-md pl-2.5 pr-2 py-1.5`}>
            <div className="flex items-center justify-between">
                <span className={`text-[11px] font-semibold ${c.label} uppercase tracking-wider`}>{label}</span>
                <div className="flex items-center gap-1">
                    <span className={`text-xs font-bold tabular-nums ${c.count}`}>{data.approved}/{data.total}</span>
                    {allApproved && <CheckCircle2 className={`h-3 w-3 ${c.check}`} />}
                </div>
            </div>
            {allApproved ? (
                <span className={`text-[10px] ${c.done} mt-0.5 block`}>All approved</span>
            ) : pendingStatuses.length > 0 ? (
                <div className="flex flex-wrap gap-1 mt-1.5">
                    {pendingStatuses.map(([status, count]) => (
                        <TooltipProvider key={status}>
                            <Tooltip delayDuration={300}>
                                <TooltipTrigger asChild>
                                    <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${getUnifiedStatusStyle(status)} cursor-default`}>
                                        <span className="truncate">{status}</span>
                                        <span className="font-bold tabular-nums">{count}</span>
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="text-xs">
                                    {status}: {count} {count === 1 ? 'task' : 'tasks'}
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    ))}
                </div>
            ) : null}
        </div>
    );
};

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
    const totalTasks = tracker.total_tasks || 0;
    const completedTasks = tracker.completed_tasks || 0;
    const completionPercentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    // Compute per-phase status breakdown from child tasks
    const phaseBreakdown = useMemo(() => {
        const tasks: any[] = tracker.design_tracker_task || [];
        if (tasks.length === 0) return null;

        const makeBucket = () => ({ approved: 0, total: 0, statuses: {} as Record<string, number> });
        const onboarding = makeBucket();
        const handover = makeBucket();

        tasks.forEach((task: any) => {
            if (task.task_status === 'Not Applicable') return;
            const bucket = task.task_phase === 'Handover' ? handover : onboarding;
            bucket.total++;
            bucket.statuses[task.task_status] = (bucket.statuses[task.task_status] || 0) + 1;
            if (task.task_status === 'Approved') bucket.approved++;
        });

        return { onboarding, handover };
    }, [tracker.design_tracker_task]);

    // Determine color based on completion percentage
    const getProgressColor = (percentage: number): string => {
        if (percentage === 100) return 'text-green-600';
        if (percentage >= 76) return 'text-green-600';
        if (percentage >= 26) return 'text-yellow-500';
        return 'text-red-600';
    };

    const progressColor = getProgressColor(completionPercentage);

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
                {/* Phase-aware Status Breakdown */}
                <div className="flex-1">
                    {phaseBreakdown ? (
                        <div className="space-y-2">
                            <PhaseStatusSection label="Onboarding" data={phaseBreakdown.onboarding} colorScheme="green" />
                            {hasHandover && (
                                <PhaseStatusSection label="Handover" data={phaseBreakdown.handover} colorScheme="blue" />
                            )}
                        </div>
                    ) : (
                        <div className="flex items-center justify-center py-4">
                            <p className="text-xs text-gray-400 italic">No tasks created yet</p>
                        </div>
                    )}
                </div>

                {/* My Assigned Tasks - Only for designers with assigned tasks */}
                {isDesigner && myAssignedTasks.total > 0 && (
                    <div className="mt-2 px-2 py-1.5 bg-blue-50 rounded-md border border-blue-100">
                        <div className="flex items-center gap-1.5">
                            <User className="h-3 w-3 text-blue-600 shrink-0" />
                            <span className="text-xs text-blue-700 font-medium">
                                {myAssignedTasks.total} {myAssignedTasks.total === 1 ? 'task' : 'tasks'} assigned to you
                            </span>
                        </div>
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
