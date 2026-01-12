import React, { useState } from "react";
import { WorkPlanItem, WorkPlanDoc, getColorForProgress } from "./SevendaysWorkPlan";
import { ChevronDown, ChevronUp, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { safeFormatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface WorkPlanOverviewProps {
    header: string;
    items: WorkPlanItem[];
    getHeaderStats: (items: WorkPlanItem[]) => { avgProgress: number; plannedActivitiesCount: number };
}

const OverviewMilestoneItem = ({ item }: { item: WorkPlanItem }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const workPlans = item.work_plan_doc || [];
    const hasWorkPlans = workPlans.length > 0;

    return (
        <div className="border rounded-lg bg-white overflow-hidden mb-2">
            <div 
                className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                {/* Left: Title */}
                <div className="flex items-center gap-3 overflow-hidden flex-1">
                    <div className="text-gray-400 shrink-0">
                         {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </div>
                    <span className="font-medium text-gray-900 truncate" title={item.work_milestone_name}>
                        {item.work_milestone_name}
                    </span>
                 </div>
                 
                 {/* Center: Zone and Status */}
                 <div className="flex items-center justify-center gap-4 shrink-0 px-4">
                        {/* Zone Badge */}
                        {/* <span className="inline-flex items-center justify-center h-6 min-w-[70px] w-fit rounded border border-dashed border-gray-300 bg-gray-50 px-3 text-[10px] text-gray-600 whitespace-nowrap">
                            {item.zone || "Zone 1"}
                        </span> */}

                        {/* Status Badge */}
                         <span className={`inline-flex items-center justify-center h-6 min-w-[70px] w-fit rounded-full px-3 text-[10px] font-medium whitespace-nowrap ${
                            item.status === "Completed"
                                ? "bg-green-100 text-green-800 border border-green-200"
                                : item.status === "WIP" || item.status === "In Progress"
                                ? "bg-orange-100 text-orange-800 border border-orange-200"
                                : item.status === "Not Started"
                                ? "bg-red-100 text-red-800 border border-red-200"
                                : "bg-gray-100 text-gray-800 border border-gray-200"
                        }`}>
                            {item.status}
                        </span>
                 </div>

                 {/* Right: Progress and Button */}
                 <div className="flex items-center gap-4 shrink-0 flex-1 justify-end">
                        {/* Progress */}
                        <div className="w-[40px] text-right font-semibold text-sm">
                             <span className={getColorForProgress(item.progress)}>{item.progress}%</span>
                        </div>

                         {/* Activities Button */}
                        <Button 
                            variant="outline" 
                            size="sm" 
                            className="h-7 border-blue-200 text-blue-700 font-normal hover:bg-blue-50 rounded-full text-xs min-w-[90px]"
                            onClick={(e) => {
                                e.stopPropagation();
                                setIsExpanded(!isExpanded);
                            }}
                        >
                            {workPlans.length} Activities
                        </Button>
                 </div>
            </div>

            {/* Expanded Content */}
             <div className={`overflow-hidden transition-all duration-300 ease-in-out ${isExpanded ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0"}`}>
                <div className="bg-gray-50/100 border-t border-gray-100">
                    {hasWorkPlans ? (
                        workPlans.map((plan) => (
                            <div key={plan.name} className="px-10 py-2 border-b border-gray-200 last:border-0 hover:bg-gray-50">
                                <div className="flex items-center justify-between gap-4">
                                    <div className="flex flex-col w-[40%] gap-0.5">
                                        <div className="font-medium text-sm text-gray-700 truncate" title={plan.wp_title}>
                                            {plan.wp_title}
                                        </div>
                                        {plan.wp_description && (
                                            <div className="text-xs text-gray-500 whitespace-normal break-words leading-relaxed" title={plan.wp_description}>
                                                <span className="font-semibold text-yellow-600">Note: </span>
                                                {plan.wp_description}
                                            </div>
                                        )}
                                    </div>
                                    <div className="text-xs text-gray-500 font-medium flex-1 text-center">
                                        {safeFormatDate(plan.wp_start_date, "do MMM, yyyy")} 
                                        {" - "}
                                        {safeFormatDate(plan.wp_end_date, "do MMM, yyyy")}
                                    </div>
                                    <div className="shrink-0 w-[15%] flex justify-end">
                                         <Badge variant="outline" className={`px-2 py-0 h-5 text-[10px] ${
                                            plan.wp_status === 'Pending' ? 'bg-yellow-50 text-yellow-700 border-yellow-200' :
                                            plan.wp_status === 'Completed' ? 'bg-green-50 text-green-700 border-green-200' :
                                            plan.wp_status === 'In Progress' ? 'bg-orange-50 text-orange-700 border-orange-200' :
                                            'bg-gray-50 text-gray-700 border-gray-200'
                                        }`}>
                                            {plan.wp_status || 'Pending'}
                                        </Badge>
                                    </div>
                                </div>
                            </div>
                        ))
                    ) : (
                        <div className="p-4 text-center text-xs text-gray-500 italic">No planned activities found.</div>
                    )}
                </div>
            </div>
        </div>
    );
};


export const WorkPlanOverview = ({ header, items, getHeaderStats }: WorkPlanOverviewProps) => {
    // We assume items are already filtered by SevendaysWorkPlan for overview (only with items)
    const { plannedActivitiesCount } = getHeaderStats(items);
    const [isExpanded, setIsExpanded] = useState(true);

    return (
        <div className={`overflow-hidden mb-4 transition-colors ${isExpanded ? "bg-gray-50 rounded-md pb-2" : "bg-white"}`}>
            {/* Header */}
            <div 
                className={`flex items-center justify-between cursor-pointer transition-colors ${
                    !isExpanded 
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

            {/* List */}
            {isExpanded && (
                <div className="mt-2 mx-8">
                    {items.map((item, idx) => (
                        <OverviewMilestoneItem key={idx} item={item} />
                    ))}
                </div>
            )}
        </div>
    );
};
