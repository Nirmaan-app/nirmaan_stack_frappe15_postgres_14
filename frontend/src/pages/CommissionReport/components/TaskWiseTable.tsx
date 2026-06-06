import React, { useCallback, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
    ColumnDef,
    getCoreRowModel,
    getFacetedRowModel,
    getFacetedUniqueValues,
    useReactTable,
} from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/use-toast";
import { TableSkeleton } from "@/components/ui/skeleton";
import { DataTable } from "@/components/data-table/new-data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { useServerDataTable } from "@/hooks/useServerDataTable";

import { useCommissionMasters } from "../hooks/useCommissionMasters";
import { TaskEditModal } from "./ReportEditModal";
import { type MasterTaskInfo } from "./FillReportButton";
import { ReportActionCell } from "./ReportActionCell";
import { useMasterTaskMap } from "../report-wizard/data/useMasterTaskMap";
import { CommissionReportTask } from "../types";
import {
    formatDeadlineShort,
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
    checkIfUserAssigned: (task: FlattenedTask) => boolean,
    masterMap: Map<string, MasterTaskInfo>,
    refresh: () => void
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
            header: ({ column }) => <DataTableColumnHeader column={column} title="Report Name" />,
        },
        {
            accessorKey: "report_type",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Report Type" />,
            cell: ({ row }) => {
                const rt = row.original.report_type || "Field";
                return (
                    <span className={`py-0.5 px-2 text-[10px] rounded-full border ${rt === "Vendor"
                        ? "bg-orange-50 text-orange-700 border-orange-200"
                        : "bg-sky-50 text-sky-700 border-sky-200"}`}>
                        {rt}
                    </span>
                );
            },
            enableColumnFilter: true,
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
        {
            accessorKey: "task_status",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
            cell: ({ row }) => (
                <div className="flex justify-center">
                    <Badge
                        variant="outline"
                        className={`max-w-[120px] min-h-[22px] py-0.5 px-2 text-[10px] justify-center whitespace-normal break-words text-center leading-tight rounded-full ${getUnifiedStatusStyle(row.original.task_status || "...")}`}
                    >
                        {row.original.task_status || "..."}
                    </Badge>
                </div>
            ),
            enableColumnFilter: true,
            size: 120, minSize: 100, maxSize: 140,
        },
        {
            id: "action",
            header: () => <div className="w-full text-center">Actions / Reports</div>,
            cell: ({ row }) => {
                const canEdit = !isDesignExecutive || (isDesignExecutive && checkIfUserAssigned(row.original));
                return (
                    <ReportActionCell
                        parentName={row.original.prjname}
                        task={row.original}
                        masterMap={masterMap}
                        canEdit={canEdit}
                        refresh={refresh}
                        onConfigure={(t) => handleEditClick(t as FlattenedTask)}
                    />
                );
            },
            size: 210, minSize: 180, maxSize: 250,
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
    const { map: masterMap } = useMasterTaskMap();

    const [editingTask, setEditingTask] = useState<FlattenedTask | null>(null);
    const refetchRef = useRef<() => void>(() => {});
    const refresh = useCallback(() => refetchRef.current?.(), []);

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
                { label: "Pending Approval", value: "Pending Approval" },
                { label: "Approved", value: "Approved" },
                { label: "Completed", value: "Completed" },
            ],
        },
        report_type: {
            title: "Report Type",
            options: [
                { label: "Field", value: "Field" },
                { label: "Vendor", value: "Vendor" },
            ],
        },
    }), [FacetProjectsOptions, categoryData]);

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
            () => getTaskWiseColumns(setEditingTask, isDesignExecutive, checkIfUserAssigned, masterMap, refresh),
            [isDesignExecutive, checkIfUserAssigned, masterMap, refresh]
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
            "report_type",
            "file_link",
            "approval_proof",
            "response_data",
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

    refetchRef.current = serverDataTable.refetch;

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
