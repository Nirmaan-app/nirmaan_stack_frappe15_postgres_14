import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ProgressCircle } from "@/components/ui/ProgressCircle";
import { ArrowUpRight } from "lucide-react";
import { getUnifiedStatusStyle } from "../utils";

interface ProjectWiseCardProps {
    tracker: any;
    onClick?: () => void;
}

export const ProjectWiseCard: React.FC<ProjectWiseCardProps> = ({ tracker, onClick }) => {

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
                        title={tracker.project_name}
                    >
                        {tracker.project_name}
                    </CardTitle>

                    {/* Progress Circle - Single indicator with color-coded progress */}
                    <ProgressCircle
                        value={completionPercentage}
                        className={`size-12 flex-shrink-0 ${progressColor}`}
                        textSizeClassName="text-[10px]"
                    />
                </div>
            </CardHeader>

            <CardContent className="flex-1 flex flex-col justify-between pt-0 pb-4">
                {/* Task Counter */}
                <div className="mb-4">
                    <div className="text-xs text-gray-500 mb-1">Drawings Approved</div>
                    <div className="flex items-baseline gap-1.5">
                        <span className={`text-2xl font-bold tabular-nums ${progressColor}`}>
                            {completedTasks}
                        </span>
                        <span className="text-lg text-gray-400">/</span>
                        <span className="text-lg font-semibold text-gray-600 tabular-nums">
                            {totalTasks}
                        </span>
                    </div>
                </div>

                {/* Status Breakdown */}
                {totalTasks > 0 ? (
                    <div className="flex-1">
                        <div className="grid grid-cols-2 gap-2">
                            {Object.entries(statusCounts).map(([status, count]) => (
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
