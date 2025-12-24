import React, { useMemo, useState } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";
import { format } from "date-fns";
import { AlertCircle, Calendar, CheckCircle, Circle, Loader2, ChevronDown, ChevronUp, Pencil, Trash2 } from "lucide-react";
import { ProgressCircle } from "@/components/ui/ProgressCircle";
import { CreateWorkplantask } from "./CreateWorkplantask";
import { Badge } from "@/components/ui/badge";
import { useFrappeDeleteDoc } from "frappe-react-sdk";
import { useToast } from "@/components/ui/use-toast";
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
    work_plan_doc?: WorkPlanDoc[];
    source: string;
}

interface WorkPlanDoc {
    name: string;
    wp_title: string;
    wp_status: string;
    wp_start_date: string;
    wp_end_date: string;
    wp_description: string;
}

const getColorForProgress = (value: number): string => {
    const val = Math.round(value);
    if (isNaN(val)) return "text-gray-500";
    if (val === 0) return "text-gray-400"; // Using gray-400 for 0 instead of black-500
    if (val < 50) return "text-red-600";
    if (val < 75) return "text-yellow-600";
    if (val < 100) return "text-green-600";
    return "text-green-500";
};

const MilestoneRow = ({ item, onAddTask, onEditTask, onDeleteTask }: { 
    item: WorkPlanItem, 
    onAddTask: (item: WorkPlanItem) => void,
    onEditTask: (plan: WorkPlanDoc, item: WorkPlanItem) => void,
    onDeleteTask: (planName: string) => void
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
                <td className="px-4 py-3 font-medium text-gray-900 border-b-0">
                    <span className="inline-block rounded border border-dashed border-gray-300 bg-gray-50 px-2 py-1 text-xs text-gray-600">
                        {item.zone || "Zone 1"}
                    </span>
                </td>
                <td className="px-4 py-3 border-b-0">
                        <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
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

                <td className="px-4 py-3 text-gray-700 border-b-0">
                    <div className="flex items-center gap-2">
                        <ProgressCircle 
                            value={item.progress} 
                            className={`size-10 ${getColorForProgress(item.progress)}`}
                            textSizeClassName="text-[10px]"
                        />
                    </div>
                </td>
                <td className="px-4 py-3 text-xs font-medium text-gray-700 border-b-0">
                    {item.expected_starting_date ? (
                        <span className="text-red-600 font-bold">{format(new Date(item.expected_starting_date), "dd/MM/yyyy")}</span>
                    ) : "NA"}
                </td>
                <td className="px-4 py-3 text-xs font-medium text-gray-700 border-b-0">
                        {item.expected_completion_date ? (
                        <span className="text-red-600 font-bold">{format(new Date(item.expected_completion_date), "dd/MM/yyyy")}</span>
                    ) : "NA"}
                </td>
                <td className="px-4 py-3 border-b-0">
                        <button 
                        className="flex items-center rounded-full border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-colors"
                        onClick={() => onAddTask(item)}
                        >
                        <span className="mr-1 text-lg leading-none">+</span> Add Task
                        </button>
                </td>
            </tr>
            {hasWorkPlans && (
                <tr>
                    <td colSpan={7} className="px-4 pb-4 pt-0">
                        <div className="rounded-md border bg-blue-50/30">
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
                                        <div key={plan.name} className="flex items-center justify-between rounded-lg border bg-white p-3 shadow-sm">
                                            <div className="space-y-1">
                                                <div className="font-semibold text-gray-900">{plan.wp_title}</div>
                                                {plan.wp_description && (
                                                    <div className="text-xs italic text-gray-500 line-clamp-1">
                                                        Note: {plan.wp_description}
                                                    </div>
                                                )}
                                            </div>
                                            
                                            <div className="flex items-center gap-6">
                                                <div className="flex flex-col items-center gap-1">
                                                    <span className="text-[10px] font-semibold text-gray-500 uppercase">Status</span>
                                                    <span className={`rounded px-2 py-0.5 text-xs font-medium border ${
                                                        plan.wp_status === 'Pending' ? 'bg-yellow-50 text-yellow-700 border-yellow-200' :
                                                        plan.wp_status === 'Completed' ? 'bg-green-50 text-green-700 border-green-200' :
                                                        'bg-gray-50 text-gray-700 border-gray-200'
                                                    }`}>
                                                        {plan.wp_status || 'Pending'}
                                                    </span>
                                                </div>

                                                <div className="flex flex-col items-center gap-1">
                                                    <span className="text-[10px] font-semibold text-gray-500 uppercase">Start Date</span>
                                                    <div className="rounded border px-2 py-1 text-xs font-medium bg-gray-50">
                                                        {plan.wp_start_date ? format(new Date(plan.wp_start_date), "dd/MM/yyyy") : "-"}
                                                    </div>
                                                </div>

                                                <div className="flex flex-col items-center gap-1">
                                                    <span className="text-[10px] font-semibold text-gray-500 uppercase">End Date</span>
                                                    <div className="rounded border px-2 py-1 text-xs font-medium bg-gray-50">
                                                        {plan.wp_end_date ? format(new Date(plan.wp_end_date), "dd/MM/yyyy") : "-"}
                                                    </div>
                                                </div>

                                                <div className="flex items-center gap-2 pl-4 border-l">
                                                    <button 
                                                        className="text-gray-400 hover:text-blue-600 transition-colors"
                                                        onClick={() => onEditTask(plan, item)}
                                                    >
                                                        <Pencil className="h-4 w-4" />
                                                    </button>
                                                    <button 
                                                        className="text-gray-400 hover:text-red-600 transition-colors"
                                                        onClick={() => onDeleteTask(plan.name)}
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </button>
                                                </div>
                                            </div>
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
}: SevendaysWorkPlanProps) => {
    // ... no change to props ...

    const [isMainExpanded, setIsMainExpanded] = useState(true);
    const { toast } = useToast();
    const { deleteDoc } = useFrappeDeleteDoc();

    const shouldFetch = projectId && startDate && endDate;
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
                  start_date: format(startDate, "yyyy-MM-dd"),
                  end_date: format(endDate, "yyyy-MM-dd"),
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

    const closeCreateTask = () => {
        setCreateTaskState((prev) => ({ ...prev, isOpen: false }));
    };

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

    const workHeaders = result?.message ? Object.keys(result.message) : [];
    const hasData = workHeaders.length > 0;

    // Moved isMainExpanded state to top level to fix hook violation

    return (
        <div className="space-y-6">
             <div className="overflow-hidden rounded-lg border bg-white shadow-sm">
                <div 
                    className="flex cursor-pointer items-center justify-between border-b bg-white px-6 py-4 transition-colors hover:bg-gray-50"
                    onClick={() => setIsMainExpanded(!isMainExpanded)}
                >
                    <div className="flex items-center gap-3">
                        <h3 className="text-lg font-bold text-gray-900">Work Milestones</h3>
                        <Badge variant="secondary" className="bg-blue-600 text-white hover:bg-blue-700">
                             {workHeaders.length}
                        </Badge>
                    </div>
                     {isMainExpanded ? (
                        <ChevronUp className="h-5 w-5 text-gray-500" />
                    ) : (
                        <ChevronDown className="h-5 w-5 text-gray-500" />
                    )}
                </div>
                
                {isMainExpanded && (
                    <div className="bg-gray-50/50 p-6 space-y-4">
                        {!hasData ? (
                            <div className="rounded-lg border bg-gray-50 p-8 text-center text-gray-500">
                                No work plan items found for this period.
                            </div>
                        ) : (
                            workHeaders.map((header) => {
                                const items = result?.message[header] || [];
                                const avgProgress = Math.round(
                                    items.reduce((acc, curr) => acc + (Number(curr.progress) || 0), 0) / (items.length || 1)
                                );
                                const plannedActivitiesCount = items.reduce((acc, item) => acc + (item.work_plan_doc?.length || 0), 0);
                                const isExpanded = expandedHeaders[header] !== false;

                                return (
                                    <div key={header} className="overflow-hidden rounded-lg border bg-white shadow-sm">
                                        <div 
                                            className="flex cursor-pointer items-center justify-between border-b bg-gray-50/30 px-4 py-3 transition-colors hover:bg-gray-100"
                                            onClick={() => toggleHeader(header)}
                                        >
                                            <div className="flex items-center gap-3">
                                                <h4 className="font-bold text-gray-900">{header}</h4>
                                                <span className="rounded-full bg-blue-100 px-3 py-0.5 text-xs font-medium text-blue-800 border border-blue-200">
                                                    {plannedActivitiesCount} Planned Activities
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-4">
                                                <div className="text-sm text-gray-600 flex items-center gap-2">
                                                    Overall Progress: <span className={`font-bold ${getColorForProgress(avgProgress)}`}>{avgProgress}%</span>
                                                </div>
                                                <div className="flex h-8 w-8 items-center justify-center rounded border border-gray-200 bg-white shadow-sm">
                                                    {isExpanded ? (
                                                        <ChevronUp className="h-4 w-4 text-gray-500" />
                                                    ) : (
                                                        <ChevronDown className="h-4 w-4 text-gray-500" />
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        {isExpanded && (
                                            <div className="p-0">
                                                <table className="w-full text-left text-sm">
                                                    <thead className="bg-gray-100/50">
                                                        <tr>
                                                            <th className="px-4 py-3 font-semibold text-gray-900">Work</th>
                                                            <th className="px-4 py-3 font-semibold text-gray-900">Zone</th>
                                                            <th className="px-4 py-3 font-semibold text-gray-900">Status</th>
                                                            <th className="px-4 py-3 font-semibold text-gray-900">Progress</th>
                                                            <th className="px-4 py-3 font-semibold text-gray-900">Start Date</th>
                                                            <th className="px-4 py-3 font-semibold text-gray-900">End Date</th>
                                                            <th className="px-4 py-3 font-semibold text-gray-900">Admin Actions</th>
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
                                                            />
                                                        ))}
                                                    </tbody>
                                                </table>
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
