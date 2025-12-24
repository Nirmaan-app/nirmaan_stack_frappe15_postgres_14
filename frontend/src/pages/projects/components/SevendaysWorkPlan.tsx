import React, { useMemo } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";
import { format } from "date-fns";
import { AlertCircle, Calendar, CheckCircle, Circle, Loader2 } from "lucide-react";

interface SevendaysWorkPlanProps {
    projectId: string;
    startDate: Date | undefined;
    endDate: Date | undefined;
}

interface WorkPlanItem {
    project: string;
    zone: string;
    work_milestone_name: string;
    work_header: string;
    status: string;
    progress: number;
    expected_starting_date: string;
    expected_completion_date: string;
    work_plan_details?: any;
    source: string;
}

export const SevendaysWorkPlan = ({
    projectId,
    startDate,
    endDate,
}: SevendaysWorkPlanProps) => {
    const shouldFetch = projectId && startDate && endDate;
    const { data: result, error, isLoading: loading } = useFrappeGetCall<{
        message: WorkPlanItem[];
    }>(
        shouldFetch
            ? "nirmaan_stack.api.seven_days_planning.work_plan_api.get_work_plan"
            : null,
        shouldFetch
            ? {
                  project: projectId,
                  start_date: format(startDate, "yyyy-MM-dd"),
                  end_date: format(endDate, "yyyy-MM-dd"),
              }
            : undefined
    );

    // Removed manual useEffect as useFrappeGetCall handles fetching automatically
    // Group by Zone -> Work Milestone
    const groupedData = useMemo(() => {
        if (!result?.message) return {};
        const groups: Record<string, Record<string, WorkPlanItem[]>> = {};

        result.message.forEach((item) => {
            const zone = item.zone || "Unassigned Zone";
            const milestone = item.work_milestone_name || "Unnamed Milestone";

            if (!groups[zone]) {
                groups[zone] = {};
            }
            if (!groups[zone][milestone]) {
                groups[zone][milestone] = [];
            }
            groups[zone][milestone].push(item);
        });

        return groups;
    }, [result]);

    if (!startDate || !endDate) {
        return (
            <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-gray-500">
                <Calendar className="mr-2 h-5 w-5" />
                Select a date range to view the work plan.
            </div>
        );
    }

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

    const hasData = Object.keys(groupedData).length > 0;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">
                    Work Plan ({format(startDate, "dd MMM")} -{" "}
                    {format(endDate, "dd MMM")})
                </h3>
            </div>

            {!hasData ? (
                <div className="rounded-lg border bg-gray-50 p-8 text-center text-gray-500">
                    No work plan items found for this period.
                </div>
            ) : (
                Object.entries(groupedData).map(([zone, milestones]) => (
                    <div key={zone} className="overflow-hidden rounded-lg border bg-white shadow-sm">
                        <div className="border-b bg-gray-50/50 px-4 py-3">
                            <h4 className="font-semibold text-gray-700">{zone}</h4>
                        </div>
                        <div className="divide-y">
                            {Object.entries(milestones).map(([milestoneName, items]) => {
                                // Use the first item to get shared milestone details
                                const milestoneInfo = items[0];
                                return (
                                    <div key={milestoneName} className="p-4 hover:bg-gray-50/30">
                                        {/* Milestone Header */}
                                        <div className="mb-3 flex items-start justify-between">
                                            <div>
                                                <h5 className="font-medium text-gray-900">
                                                    {milestoneName}
                                                </h5>
                                                <p className="text-sm text-gray-500">{milestoneInfo.work_header}</p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                 <span
                                                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                                                        milestoneInfo.progress === 100
                                                            ? "bg-green-100 text-green-800"
                                                            : milestoneInfo.progress > 0
                                                            ? "bg-blue-100 text-blue-800"
                                                            : "bg-gray-100 text-gray-800"
                                                    }`}
                                                >
                                                    {milestoneInfo.progress}%
                                                </span>
                                            </div>
                                        </div>

                                        {/* Work Plan Tasks (Sub-items) */}
                                        <div className="ml-4 space-y-2 border-l-2 border-gray-100 pl-4">
                                            {items.map((item, idx) => (
                                                <div key={idx} className="rounded border bg-white p-3 text-sm shadow-sm">
                                                    {/* Display Work Plan Details if available, else generic info */}
                                                    <div className="flex items-center justify-between">
                                                        <span className="font-medium text-gray-700">
                                                            {/* If source is Work Plan Doc, maybe show something specific from details? 
                                                                Currently API doesn't return a specific 'task name' field from Work Plan other than the doc itself.
                                                                Let's genericize or imply title.
                                                            */}
                                                            {item.source === "Work Plan Document" ? "Planned Activity" : "Milestone Schedule"}
                                                        </span>
                                                        <span className="text-xs text-gray-400">{item.source}</span>
                                                    </div>
                                                    
                                                    <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-gray-500">
                                                        <span>
                                                            Start:{" "}
                                                            <span className="font-medium text-gray-700">
                                                                {item.expected_starting_date || "N/A"}
                                                            </span>
                                                        </span>
                                                        <span>
                                                            End:{" "}
                                                            <span className="font-medium text-gray-700">
                                                                {item.expected_completion_date || "N/A"}
                                                            </span>
                                                        </span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))
            )}
        </div>
    );
};
