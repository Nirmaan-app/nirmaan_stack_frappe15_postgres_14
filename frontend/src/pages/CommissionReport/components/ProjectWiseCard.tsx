import React, { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { ProgressCircle } from "@/components/ui/ProgressCircle";
import { ArrowUpRight, CheckCircle2, Eye, EyeOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PROJECT_STATUS_BADGE_CLASSES } from "@/components/common/projectStatus";

// --- Phase Status Section (compact, left-border accent) ---
interface ProjectWiseCardProps {
    tracker: any;
    onClick?: () => void;
    showHiddenBadge?: boolean;
    onHideToggle?: (trackerId: string, newHiddenState: boolean) => void;
}

export const ProjectWiseCard: React.FC<ProjectWiseCardProps> = ({ tracker, onClick, showHiddenBadge, onHideToggle }) => {
    const isHidden = tracker.hide_commission_report === 1;
    // Determine counts from commission report tasks
    const tasks: any[] = tracker.commission_report_task || [];
    
    // Status metrics mapping exactly to the 2x2 grid design
    const statusCounts = useMemo(() => {
        let notApplicable = 0;
        let pending = 0;
        let inProgress = 0;
        let completed = 0;

        tasks.forEach((task: any) => {
            const status = task.task_status;
            if (status === 'Not Applicable') {
                notApplicable++;
            } else if (status === 'Pending') {
                pending++;
            } else if (status === 'In Progress') {
                inProgress++;
            } else if (status === 'Completed') {
                completed++;
            } else {
                // Catch all other non-finished tasks as pending
                pending++;
            }
        });

        return { notApplicable, pending, inProgress, completed };
    }, [tasks]);

    const activeTasks = tasks.length - statusCounts.notApplicable;
    const completionPercentage = activeTasks > 0 ? Math.round((statusCounts.completed / activeTasks) * 100) : 0;

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
            className={`
                group flex flex-col justify-between
                border border-gray-200 bg-white rounded-xl
                transition-all duration-300 ease-in-out
                hover:shadow-md hover:border-blue-400
                cursor-pointer h-full min-h-[220px]
                ${isHidden && showHiddenBadge ? 'border-orange-300 bg-orange-50/30' : 'border-gray-200'}
            `}
            onClick={onClick}
        >
            <div className="p-4 flex flex-col h-full relative">
                {/* Header: Project Name & Progress */}
                <div className="flex justify-between items-start mb-4">
                    <div className="flex-1 flex flex-col gap-1 pr-2">
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
                        <div className="flex items-center gap-1.5 flex-wrap">
                            <h3 className="font-semibold text-gray-900 text-lg leading-tight line-clamp-2">
                                {tracker.project_name}
                            </h3>
                            {tracker.status_of_project && (
                                <Badge
                                    variant="outline"
                                    className={`text-[10px] px-1.5 py-0 shrink-0 font-medium ${PROJECT_STATUS_BADGE_CLASSES[tracker.status_of_project] || 'bg-gray-100 text-gray-700 border-gray-300'}`}
                                    title="Project status"
                                >
                                    {tracker.status_of_project}
                                </Badge>
                            )}
                        </div>
                    </div>
                    {tracker.has_tracker ? (
                        <ProgressCircle
                            value={completionPercentage}
                            className={`size-[38px] flex-shrink-0 ${progressColor}`}
                            textSizeClassName="text-[10px]"
                        />
                    ) : (
                        <div className="size-[38px] flex-shrink-0 flex items-center justify-center rounded-full bg-gray-100 border border-gray-200 text-gray-400 text-xs">
                            --
                        </div>
                    )}
                </div>

                {!tracker.has_tracker ? (
                    <div className="flex-1 flex flex-col items-center justify-center py-4 text-center">
                        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center mb-2">
                            <CheckCircle2 className="h-4 w-4 text-blue-500" />
                        </div>
                        <p className="text-sm font-medium text-gray-700">Ready for Commissioning</p>
                        <p className="text-xs text-gray-400 mt-1 max-w-[200px]">Click to set up report</p>
                    </div>
                ) : (
                    <>
                        {/* Total Tasks Metric */}
                        <div className="mb-4">
                            <p className="text-xs text-gray-500 font-medium mb-0.5">Total Tasks</p>
                            <p className="text-3xl font-bold text-gray-900 tabular-nums leading-none">
                                {tasks.length}
                            </p>
                        </div>

                        <div className="mt-auto">
                            {/* 2x2 Grid for status counts */}
                            <div className="grid grid-cols-2 gap-2 mb-4">
                                {/* Not Applicable */}
                                <div className="flex items-center justify-between text-[11px] px-2.5 py-1.5 bg-gray-50/80 rounded-md border border-gray-100">
                                    <span className="text-gray-500">Not Applicable</span>
                                    <span className="font-semibold text-gray-700">{statusCounts.notApplicable}</span>
                                </div>
                                {/* Pending */}
                                <div className="flex items-center justify-between text-[11px] px-2.5 py-1.5 bg-amber-50/80 rounded-md border border-amber-100">
                                    <span className="text-amber-700">Pending</span>
                                    <span className="font-semibold text-amber-900">{statusCounts.pending}</span>
                                </div>
                                {/* In Progress */}
                                <div className="flex items-center justify-between text-[11px] px-2.5 py-1.5 bg-blue-50/80 rounded-md border border-blue-100">
                                    <span className="text-blue-700">In Progress</span>
                                    <span className="font-semibold text-blue-900">{statusCounts.inProgress}</span>
                                </div>
                                {/* Completed */}
                                <div className="flex items-center justify-between text-[11px] px-2.5 py-1.5 bg-green-50/80 rounded-md border border-green-100">
                                    <span className="text-green-700">Completed</span>
                                    <span className="font-semibold text-green-900">{statusCounts.completed}</span>
                                </div>
                            </div>

                            {/* Footer: Toggle Hide and View Details */}
                            <div className="border-t border-gray-100 pt-3 mt-auto">
                                <div className="flex justify-between items-center text-xs font-medium">
                                    {/* Hide/Unhide Button */}
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

                                    <div className="flex items-center gap-1 text-red-500 hover:text-red-600 transition-colors group/link">
                                        <span>View Details</span>
                                        <ArrowUpRight className="w-3.5 h-3.5 group-hover/link:-translate-y-[2px] group-hover/link:translate-x-[2px] transition-transform" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </Card>
    );
};
