import React, { useMemo, useState } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";
import { format } from "date-fns";
import { safeFormatDate } from "@/lib/utils";
import { AlertCircle, Calendar, CheckCircle, Circle, Loader2, ChevronDown, ChevronUp, Pencil, Trash2,Download } from "lucide-react";
import { ProgressCircle } from "@/components/ui/ProgressCircle";
import { CreateWorkplantask } from "./CreateWorkplantask";
import { Badge } from "@/components/ui/badge";
import { WorkPlanOverview } from "./WorkPlanOverview";
import { useFrappeDeleteDoc } from "frappe-react-sdk";
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
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

interface SevendaysWorkPlanProps {
    projectId: string;
    startDate: Date | undefined;
    endDate: Date | undefined;
    isOverview?: boolean;
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
}

export interface WorkPlanDoc {
    name: string;
    wp_title: string;
    wp_status: string;
    wp_start_date: string;
    wp_end_date: string;
    wp_description: string;
}

export const getColorForProgress = (value: number): string => {
    const val = Math.round(value);
    if (isNaN(val)) return "text-gray-500";
    if (val === 0) return "text-gray-400"; // Using gray-400 for 0 instead of black-500
    if (val < 50) return "text-red-600";
    if (val < 75) return "text-yellow-600";
    if (val < 100) return "text-green-600";
    return "text-green-500";
};

const MilestoneRow = ({ item, onAddTask, onEditTask, onDeleteTask, isOverview }: { 
    item: WorkPlanItem, 
    onAddTask: (item: WorkPlanItem) => void,
    onEditTask: (plan: WorkPlanDoc, item: WorkPlanItem) => void,
    onDeleteTask: (planName: string) => void,
    isOverview?: boolean
}) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const workPlans = item.work_plan_doc || [];
    const hasWorkPlans = workPlans.length > 0;

    return (
        <>
            <tr className="hover:bg-gray-50/50">
                <td className="px-4 py-3 text-gray-700 border-b-0">
                    <div className="font-medium text-gray-900">{item.work_milestone_name}</div>
                </td>
                <td className="px-4 py-3 font-medium text-gray-900 border-b-0 text-center">
                    <span className="inline-flex items-center justify-center h-6 w-[100px] rounded border border-dashed border-gray-300 bg-gray-50 px-2 text-xs text-gray-600 truncate">
                        {item.zone || "Zone 1"}
                    </span>
                </td>
                <td className="px-4 py-3 border-b-0 text-center">
                        <span
                        className={`inline-flex items-center justify-center h-6 w-[100px] rounded-full px-2 text-xs font-medium truncate ${
                            item.status === "Completed"
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
                        <span className="text-red-600 font-bold">{safeFormatDate(item.expected_starting_date)}</span>
                    ) : "NA"}
                </td>
                <td className="px-4 py-3 text-xs font-medium text-gray-700 border-b-0 text-center">
                        {item.expected_completion_date ? (
                        <span className="text-red-600 font-bold">{safeFormatDate(item.expected_completion_date)}</span>
                    ) : "NA"}
                </td>
                {!isOverview && (
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
            {hasWorkPlans && (
                <tr>
                    <td colSpan={isOverview ? 6 : 7} className=" pb-2 pt-0 m-0 p-0">
                        <div className="rounded-md border-b bg-blue-50/30">
                            <button 
                                className="flex w-full items-center justify-between px-4 py-2 text-sm text-blue-800 hover:bg-blue-50"
                                onClick={() => setIsExpanded(!isExpanded)}
                            >
                                <div className="flex items-center gap-2 font-semibold">
                                    Planned Activities 
                                    <Badge className="bg-blue-700 text-white hover:bg-blue-800 h-5 w-5 p-0 flex items-center justify-center rounded-full text-[10px]">
                                        {workPlans.length}
                                    </Badge>
                                </div>
                                {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </button>
                            
                            {isExpanded && (
                                <div className="space-y-3 p-4">
                                    {workPlans.map((plan) => (
                                        <div key={plan.name} className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4 shadow-[0_2px_4px_rgba(0,0,0,0.02)] hover:shadow-md transition-shadow">
                                            {/* Left: Title and Note */}
                                            <div className="space-y-1.5 w-[300px] shrink-0 pr-4">
                                                <div className="font-semibold text-gray-900 text-sm leading-tight truncate" title={plan.wp_title}>{plan.wp_title}</div>
                                                {plan.wp_description && (
                                                    <div className="text-xs italic text-gray-500 line-clamp-2 leading-relaxed">
                                                        <span className="font-medium text-amber-600 not-italic">Note: </span>
                                                        {plan.wp_description}
                                                    </div>
                                                )}
                                            </div>
                                            
                                            {/* Center: Status and Date Metadata */}
                                            <div className="flex items-center gap-2 shrink-0 mx-4">
                                                <div className="flex flex-col items-center gap-1.5 w-[100px]">
                                                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Status</span>
                                                    <span className={`w-full text-center rounded-md px-2 py-1 text-xs font-semibold border truncate ${
                                                        plan.wp_status === 'Pending' ? 'bg-yellow-50 text-yellow-700 border-yellow-200' :
                                                        plan.wp_status === 'Completed' ? 'bg-green-50 text-green-700 border-green-200' :
                                                        plan.wp_status === 'In Progress' ? 'bg-orange-50 text-orange-700 border-orange-200' :
                                                        'bg-gray-50 text-gray-700 border-gray-200'
                                                    }`}>
                                                        {plan.wp_status || 'Pending'}
                                                    </span>
                                                </div>

                                                <div className="flex flex-col items-center gap-1.5 w-[110px]">
                                                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Start Date</span>
                                                    <div className="w-full text-center rounded border px-2 py-1 text-xs font-semibold bg-white text-gray-700 shadow-sm truncate">
                                                        {safeFormatDate(plan.wp_start_date)}
                                                    </div>
                                                </div>

                                                <div className="flex flex-col items-center gap-1.5 w-[110px]">
                                                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">End Date</span>
                                                    <div className="w-full text-center rounded border px-2 py-1 text-xs font-semibold bg-white text-gray-700 shadow-sm truncate">
                                                        {safeFormatDate(plan.wp_end_date)}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Right: Actions */}
                                            {!isOverview && (
                                                <div className="flex items-center gap-1 pl-4 border-l border-gray-100 h-8">
                                                    <button 
                                                        className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-all"
                                                        onClick={() => onEditTask(plan, item)}
                                                        title="Edit Task"
                                                    >
                                                        <Pencil className="h-4 w-4" />
                                                    </button>
                                                    <button 
                                                        className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-all"
                                                        onClick={() => onDeleteTask(plan.name)}
                                                        title="Delete Task"
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
};

export const SevendaysWorkPlan = ({
    projectId,
    startDate,
    endDate,
    isOverview,
}: SevendaysWorkPlanProps) => {
    // ... no change to props ...

    const [isMainExpanded, setIsMainExpanded] = useState(true);
    const { toast } = useToast();
    const { deleteDoc } = useFrappeDeleteDoc();

    const shouldFetch = projectId;
    // Response is Record<WorkHeader, WorkPlanItem[]>
    const { data: result, error, isLoading: loading, mutate } = useFrappeGetCall<{
        message: Record<string, WorkPlanItem[]>;
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

    const [expandedHeaders, setExpandedHeaders] = useState<Record<string, boolean>>({});

    const toggleHeader = (header: string) => {
        setExpandedHeaders((prev) => ({
            ...prev,
            [header]: prev[header] === false ? true : false,
        }));
    };

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
    };

    const handleDeleteTask = (planName: string) => {
        setDeleteDialogState({
            isOpen: true,
            planName: planName,
        });
    };

    const confirmDelete = async () => {
        if (deleteDialogState.planName) {
            try {
                await deleteDoc("Work Plan", deleteDialogState.planName);
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

    const handleDownload = async (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsDownloading(true);
        try {
            // Attempt to download using the "Work Plan" print format on the Project
            // If the user meant a specific "Work Plan" document, this might need adjustment,
            // but usually a summary print is done via the parent (Project).
            const formatName = "Project Work Plan"; 
            
            const params = new URLSearchParams({
                doctype: "Projects",
                name: projectId,
                format: formatName,
                no_letterhead: "0",
                _lang: "en",
            });

            if (startDate) {
                params.append("start_date", format(startDate, "yyyy-MM-dd"));
            }
            if (endDate) {
                params.append("end_date", format(endDate, "yyyy-MM-dd"));
            }

            const url = `/api/method/frappe.utils.print_format.download_pdf?${params.toString()}`;

            console.log("params",params)
            
            const response = await fetch(url);
            if (!response.ok) throw new Error("Network response was not ok");
            
            const blob = await response.blob();
            const downloadUrl = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = downloadUrl;
            link.download = `WorkPlan_${projectId}_${format(new Date(), "yyyy-MM-dd")}.pdf`;
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

    let workHeaders = result?.message ? Object.keys(result.message) : [];
    
    // Filter headers if isOverview is true
    if (isOverview && result?.message) {
        workHeaders = workHeaders.filter(header => {
            const items = result.message[header];
            // Keep header only if it has at least one item with planned activities
            return items?.some(item => item.work_plan_doc && item.work_plan_doc.length > 0);
        });
    }

    const hasData = workHeaders.length > 0;

    let totalPlannedActivities = 0;
    if (result?.message) {
        Object.values(result.message).forEach((items) => {
            items.forEach((item) => {
                totalPlannedActivities += item.work_plan_doc?.length || 0;
            });
        });
    }



    return (
        <div className="space-y-6">
             <div className="overflow-hidden bg-white">
                {
                    <div 
                        className="flex cursor-pointer items-center justify-between bg-white py-2"
                        // onClick={() => setIsMainExpanded(!isMainExpanded)}
                    >
                        <div className="flex items-center gap-3">
                            <h3 className="text-xl font-bold text-gray-900">Work Plan</h3>
                            <Badge variant="secondary" className="bg-blue-700 text-white hover:bg-blue-800 h-6 w-6 p-0 flex items-center justify-center rounded-full text-[12px]">
                                 {totalPlannedActivities}
                            </Badge>
                        </div>
                        <Button 
                            variant="outline" 
                            size="sm" 
                            className="gap-2 h-8 text-xs border-gray-300 text-gray-700"
                            onClick={handleDownload}
                            disabled={isDownloading}
                        >
                            {isDownloading ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                                <Download className="h-3.5 w-3.5" />
                            )}
                            {isDownloading ? "Exporting..." : "Export"}
                        </Button>
                    </div>
                }
                
                {isMainExpanded && (
                    <div className="p-2 space-y-4">
                        {!hasData ? (
                            <div className="rounded-lg border bg-gray-50 p-8 text-center text-gray-500">
                                No work plan items found.
                            </div>
                        ) : (
                            workHeaders.map((header) => {
                                let items = result?.message[header] || [];
                                
                                if (isOverview) {
                                  items = items.filter(item => item.work_plan_doc && item.work_plan_doc.length > 0);
                                }

                                // Calculate Weighted Progress
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
                                        />
                                    );
                                }

                                return (
                                    <div key={header} className="overflow-hidden bg-white">
                                        <div 
                                            className={`flex cursor-pointer flex-col md:flex-row md:items-center justify-between gap-3 ${isExpanded?"":"border bg-gray-100/50 px-3 py-3 rounded-md"} py-3 transition-colors`}
                                            onClick={() => toggleHeader(header)}
                                        >
                                            <div className="flex flex-col items-start gap-3 md:flex-row md:items-center md:gap-3">
                                                <h4 className="font-bold text-gray-900 text-base">{`${header} - ${items.length}`}</h4>
                                                <span className="rounded-full bg-blue-200 px-2 py-0.5 text-xs font-medium text-gray-900 border border-blue-700 whitespace-nowrap">
                                                    {plannedActivitiesCount} Planned Activities
                                                </span>
                                            </div>
                                            <div className="flex items-center justify-between w-full md:w-auto md:gap-4 md:justify-start">
                                                <div className="text-sm text-gray-600 flex items-center gap-2">
                                                    {/* Overall Progress: <span className={`font-bold ${getColorForProgress(avgProgress)}`}>{avgProgress}%</span> */}
                                                </div>
                                                <div className={`flex h-8 w-8 items-center justify-center ${isExpanded?"":"bg-blue-100 rounded border border-gray-200 shadow-sm"}`}>
                                                    {isExpanded ? (
                                                        <ChevronUp className="h-4 w-4 text-gray-500" />
                                                    ) : (
                                                        <ChevronDown className="h-4 w-4 text-gray-500" />
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        {isExpanded && (
                                    <div className="overflow-x-auto rounded-lg border bg-white shadow-sm mt-2 mx-2 border-[#D7D7EC]">
                                        <div className="p-0">
                                            <table className="w-full text-left text-sm">
                                                <thead className="bg-gray-100/50">
                                                    <tr>
                                                        <th className="px-4 py-3 font-semibold text-gray-900 w-[300px]">Work</th>
                                                        <th className="px-4 py-3 font-semibold text-gray-900 w-[140px] text-center">Zone</th>
                                                        <th className="px-4 py-3 font-semibold text-gray-900 w-[140px] text-center">Status</th>
                                                        <th className="px-4 py-3 font-semibold text-gray-900 w-[100px] text-center">Progress</th>
                                                        <th className="px-4 py-3 font-semibold text-gray-900 w-[120px] text-center">Start Date</th>
                                                        <th className="px-4 py-3 font-semibold text-gray-900 w-[120px] text-center">End Date</th>
                                                        {!isOverview && (
                                                            <th className="px-4 py-3 font-semibold text-gray-900 w-[140px]">Admin Actions</th>
                                                        )}
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-100">
                                                    {items.map((item, idx) => (
                                                        <MilestoneRow 
                                                            key={idx} 
                                                            item={item} 
                                                            onAddTask={handleAddTask}
                                                            onEditTask={handleEditTask}
                                                            onDeleteTask={handleDeleteTask}
                                                            isOverview={isOverview}
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
            </div>
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



