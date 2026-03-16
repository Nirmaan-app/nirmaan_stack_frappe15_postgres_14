import React, { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
    ColumnDef,
    getCoreRowModel,
    getFacetedRowModel,
    getFacetedUniqueValues,
    useReactTable,
} from "@tanstack/react-table";
import { Edit, MessageCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DataTable } from "@/components/data-table/new-data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { useServerDataTable } from "@/hooks/useServerDataTable";

import { useCommissionMasters } from "../hooks/useCommissionMasters";
import { TaskEditModal } from "./ReportEditModal";
import { FilesCell } from "./FilesCell";
import { CommissionReportTask } from "../types";
import {
    formatDeadlineShort,
    getAssignedNameForDisplay,
    getUnifiedStatusStyle,
    parseDesignersFromField,
} from "../utils";
import { useUpdateCommissionTaskChild } from "../data/useCommissionMutations";

const PARENT_DOCTYPE = "Project Commission Report";

export const TASK_DATE_COLUMNS = ["deadline", "last_submitted"];

interface FlattenedTask extends CommissionReportTask {
    project_name: string;
    project: string;
    prjname: string;
}

interface TaskWiseTableProps {
    refetchList: () => void;
    user_id: string;
    isDesignExecutive: boolean;
    statusFilter?: string;
}

const getTaskWiseColumns = (
    handleEditClick: (task: FlattenedTask) => void,
    isDesignExecutive: boolean,
    checkIfUserAssigned: (task: FlattenedTask) => boolean
): ColumnDef<FlattenedTask>[] => {
    return [
        {
            accessorKey: "project",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Project Name" />,
            cell: ({ row }) => (
                <Link
                    to={`/commission-tracker/${row.original.prjname}`}
                    className="text-red-700 underline-offset-2 hover:underline font-medium"
                >
                    {row.original.project_name}
                </Link>
            ),
            enableColumnFilter: true,
        },
        {
            accessorKey: "task_zone",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Task Zone" />,
            cell: ({ row }) => row.original.task_zone || "--",
            enableColumnFilter: true,
        },
        {
            accessorKey: "commission_category",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Task Category" />,
            enableColumnFilter: true,
        },
        {
            accessorKey: "task_name",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Task Name" />,
        },
        {
            id: "deadline",
            accessorKey: "deadline",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Deadlines" />,
            cell: ({ row }) => (
                <div className={row.original.deadline ? "" : "text-center"}>
                    {row.original.deadline ? formatDeadlineShort(row.original.deadline) : "--"}
                </div>
            ),
        },
        ...(isDesignExecutive
            ? []
            : [{
                id: "assigned_designers",
                header: ({ column }: { column: any }) => <DataTableColumnHeader column={column} title="Assigned" />,
                cell: ({ row }: { row: any }) => (
                    <div className="text-left py-1">
                        {getAssignedNameForDisplay(row.original)}
                    </div>
                ),
                size: 220,
                minSize: 180,
            }]),
        {
            accessorKey: "task_status",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
            cell: ({ row }) => (
                <div className="flex justify-start">
                    <Badge
                        variant="outline"
                        className={`w-[120px] min-h-[28px] h-auto py-1 px-2 justify-center whitespace-normal break-words text-center leading-tight rounded-full ${getUnifiedStatusStyle(row.original.task_status || "...")}`}
                    >
                        {row.original.task_status || "..."}
                    </Badge>
                </div>
            ),
            enableColumnFilter: true,
        },
        {
            accessorKey: "file_link",
            header: () => <div className="text-center">Link/Files</div>,
            cell: ({ row }) => (
                <FilesCell
                    file_link={row.original.file_link}
                    approval_proof={row.original.approval_proof}
                    task_status={row.original.task_status}
                    size="md"
                />
            ),
            size: 90,
            maxSize: 100,
            meta: { excludeFromExport: true },
        },
        {
            accessorKey: "comments",
            header: () => <div className="text-center">Comments</div>,
            cell: ({ row }) => (
                <div className="flex justify-center">
                    <TooltipProvider>
                        <Tooltip delayDuration={300}>
                            <TooltipTrigger asChild>
                                <MessageCircle
                                    className={`h-6 w-6 p-1 bg-gray-100 rounded-md ${row.original.comments ? "cursor-pointer text-gray-600 hover:scale-110 transition-transform" : "text-gray-300"}`}
                                />
                            </TooltipTrigger>
                            {row.original.comments && (
                                <TooltipContent className="max-w-xs p-2 bg-white text-gray-900 border shadow-lg">
                                    <p className="text-xs">{row.original.comments}</p>
                                </TooltipContent>
                            )}
                        </Tooltip>
                    </TooltipProvider>
                </div>
            ),
            size: 100,
            maxSize: 110,
            meta: { excludeFromExport: true },
        },
        {
            id: "actions",
            header: () => <div className="text-center">Actions</div>,
            cell: ({ row }) => {
                const canEdit = !isDesignExecutive || (isDesignExecutive && checkIfUserAssigned(row.original));
                return (
                    <div className="flex justify-start">
                        <Button
                            variant="outline"
                            size="sm"
                            className={`h-8 ${!canEdit ? "opacity-50 cursor-not-allowed" : ""}`}
                            disabled={!canEdit}
                            onClick={() => canEdit && handleEditClick(row.original)}
                        >
                            <Edit className="h-3 w-3 mr-1" /> Edit
                        </Button>
                    </div>
                );
            },
            meta: { excludeFromExport: true },
        },
    ];
};

export const TaskWiseTable: React.FC<TaskWiseTableProps> = ({
    refetchList,
    user_id,
    isDesignExecutive,
    statusFilter,
}) => {
    const { usersList, categoryData, statusOptions, FacetProjectsOptions } = useCommissionMasters();
    const { updateTaskChild } = useUpdateCommissionTaskChild();

    const [editingTask, setEditingTask] = useState<FlattenedTask | null>(null);

    const checkIfUserAssigned = useCallback((task: FlattenedTask) => {
        const designers = parseDesignersFromField(task.assigned_designers);
        return designers.some((d) => d.userId === user_id);
    }, [user_id]);

    const taskFacetFilterOptions = useMemo(() => ({
        project: {
            title: "Project",
            options: FacetProjectsOptions || [],
        },
        commission_category: {
            title: "Category",
            options: (categoryData || []).map((cat) => ({
                label: cat.category_name,
                value: cat.category_name,
            })),
        },
        task_status: {
            title: "Status",
            options: [
                { label: "Pending", value: "Pending" },
                { label: "In Progress", value: "In Progress" },
                { label: "Completed", value: "Completed" },
            ],
        },
        ...(isDesignExecutive
            ? {}
            : {
                assigned_designers: {
                    title: "Assigned Designer",
                    options: (usersList || []).map((user) => ({
                        label: user.full_name || user.name,
                        value: user.name,
                    })),
                },
            }),
    }), [FacetProjectsOptions, categoryData, isDesignExecutive, usersList]);

    const additionalFilters = useMemo(() => {
        const baseFilters: any[] = [
            ["Commission Report Task Child Table", "task_name", "!=", undefined],
            ["Commission Report Task Child Table", "task_status", "!=", "Not Applicable"],
        ];

        if (statusFilter && statusFilter !== "All") {
            baseFilters.push(["Commission Report Task Child Table", "task_status", "=", statusFilter]);
        }

        return baseFilters;
    }, [statusFilter]);

    const serverDataTable = useServerDataTable<FlattenedTask>({
        doctype: PARENT_DOCTYPE,
        apiEndpoint: "nirmaan_stack.api.commission_report.get_task_wise_list.get_task_wise_list",
        customParams: { user_id, is_design_executive: isDesignExecutive },
        columns: useMemo(
            () => getTaskWiseColumns(setEditingTask, isDesignExecutive, checkIfUserAssigned),
            [isDesignExecutive, checkIfUserAssigned]
        ),
        fetchFields: [
            "name as prjname",
            "project_name",
            "project",
            "status",
            "name",
            "task_name",
            "commission_category",
            "task_type",
            "deadline",
            "assigned_designers",
            "task_status",
            "task_sub_status",
            "file_link",
            "approval_proof",
            "comments",
            "modified",
            "task_zone",
            "last_submitted",
        ],
        searchableFields: [
            { value: "task_name", label: "Task Name", default: true },
            { value: "project_name", label: "Project Name" },
            { value: "commission_category", label: "Category" },
            { value: "task_zone", label: "Zone" },
        ],
        defaultSort: "deadline asc",
        urlSyncKey: "cr_task_wise",
        additionalFilters,
    });

    const table = useReactTable({
        data: serverDataTable.data || [],
        columns: serverDataTable.table.options.columns,
        getCoreRowModel: getCoreRowModel(),
        manualPagination: true,
        pageCount: serverDataTable.table.getPageCount(),
        state: {
            pagination: serverDataTable.pagination,
            sorting: serverDataTable.sorting,
            columnFilters: serverDataTable.columnFilters,
            globalFilter: serverDataTable.searchTerm,
        },
        onPaginationChange: serverDataTable.setPagination,
        onSortingChange: serverDataTable.setSorting,
        onColumnFiltersChange: serverDataTable.setColumnFilters,
        onGlobalFilterChange: serverDataTable.setSearchTerm,
        getFacetedRowModel: getFacetedRowModel(),
        getFacetedUniqueValues: getFacetedUniqueValues(),
    });

    const handleTaskSave = async (updatedFields: { [key: string]: any }) => {
        if (!editingTask) return;

        const fieldsToSend: { [key: string]: any } = { ...updatedFields };

        if (Array.isArray(updatedFields.assigned_designers)) {
            fieldsToSend.assigned_designers = JSON.stringify({
                list: updatedFields.assigned_designers,
            });
        }

        try {
            await updateTaskChild(editingTask.name, fieldsToSend);
            toast({
                title: "Success",
                description: "Task updated successfully.",
                variant: "success",
            });
            serverDataTable.refetch();
            refetchList();
            setEditingTask(null);
        } catch (error: any) {
            toast({
                title: "Save Failed",
                description: error?.message || "Failed to save task.",
                variant: "destructive",
            });
        }
    };

    return (
        <>
            {serverDataTable.isLoading && !serverDataTable.data?.length ? (
                <TableSkeleton />
            ) : (
                <div className="overflow-x-auto rounded-lg shadow-sm bg-white">
                    <DataTable<FlattenedTask>
                        table={table}
                        columns={table.options.columns}
                        isLoading={serverDataTable.isLoading}
                        error={serverDataTable.error}
                        totalCount={serverDataTable.totalCount}
                        searchFieldOptions={[
                            { value: "task_name", label: "Task Name", default: true },
                            { value: "project_name", label: "Project Name" },
                            { value: "commission_category", label: "Category" },
                            { value: "task_zone", label: "Zone" },
                        ]}
                        selectedSearchField={serverDataTable.selectedSearchField}
                        onSelectedSearchFieldChange={serverDataTable.setSelectedSearchField}
                        facetFilterOptions={taskFacetFilterOptions}
                        dateFilterColumns={TASK_DATE_COLUMNS}
                        searchTerm={serverDataTable.searchTerm}
                        onSearchTermChange={serverDataTable.setSearchTerm}
                        showExportButton={true}
                        exportFileName="Commission_Task_Wise"
                        onExport="default"
                        tableHeight="60vh"
                    />
                </div>
            )}

            {editingTask && (
                <TaskEditModal
                    isOpen={!!editingTask}
                    onOpenChange={(open) => {
                        if (!open) setEditingTask(null);
                    }}
                    task={editingTask}
                    onSave={handleTaskSave}
                    usersList={usersList || []}
                    statusOptions={statusOptions}
                    existingTaskNames={[]}
                    disableTaskNameEdit={true}
                    isRestrictedMode={isDesignExecutive}
                />
            )}
        </>
    );
};
