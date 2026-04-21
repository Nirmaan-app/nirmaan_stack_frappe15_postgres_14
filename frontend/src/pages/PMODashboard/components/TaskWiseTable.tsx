import React, { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
    ColumnDef,
    getCoreRowModel,
    getFacetedRowModel,
    getFacetedUniqueValues,
    useReactTable,
} from "@tanstack/react-table";
import { Edit, ExternalLink } from "lucide-react";
import { useFrappeGetDocList } from "frappe-react-sdk";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableSkeleton } from "@/components/ui/skeleton";
import { DataTable } from "@/components/data-table/new-data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { useServerDataTable } from "@/hooks/useServerDataTable";
import { safeFormatDate } from "@/lib/utils";
import EditTaskModal from "./EditTaskModal";

interface FlattenedPMOTask {
    name: string;
    task_name: string;
    category: string;
    status: string;
    expected_completion_date: string | null;
    completion_date: string | null;
    attachment: string | null;
    project: string;
    project_name: string;
}

interface TaskWiseTableProps {
    statusFilter?: string;
}

const getTaskWiseColumns = (
    handleEditClick: (task: FlattenedPMOTask) => void
): ColumnDef<FlattenedPMOTask>[] => {
    return [
        {
            accessorKey: "project_name",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Project Name" />,
            cell: ({ row }) => (
                <Link
                    to={`/pmo-dashboard/${row.original.project}`}
                    className="text-red-700 underline-offset-2 hover:underline font-medium"
                >
                    {row.original.project_name}
                </Link>
            ),
            enableColumnFilter: true,
        },
        {
            accessorKey: "category",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Category" />,
            enableColumnFilter: true,
        },
        {
            accessorKey: "task_name",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Task Name" />,
            enableColumnFilter: true,
        },
        {
            accessorKey: "expected_completion_date",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Expected Date" />,
            enableColumnFilter: true,
            cell: ({ row }) => {
                const date = row.original.expected_completion_date;
                if (!date) return "--";

                const isOverdue = new Date(date) < new Date() && (row.original.status === "Not Defined" || row.original.status === "WIP");
                
                return (
                    <span className={isOverdue ? "text-red-600 font-semibold" : ""}>
                        {safeFormatDate(date)}
                    </span>
                );
            },
        },
        {
            accessorKey: "status",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
            cell: ({ row }) => {
                const status = row.original.status;
                let colorClass = "bg-gray-100 text-gray-800";
                if (status === "Sent/Submision") colorClass = "bg-blue-100 text-blue-800";
                if (status === "Approve by client" || status === "Completed") colorClass = "bg-green-100 text-green-800";
                if (status === "WIP") colorClass = "bg-amber-100 text-amber-800";

                return (
                    <Badge variant="outline" className={`${colorClass} border-none`}>
                        {status}
                    </Badge>
                );
            },
            enableColumnFilter: true,
        },
        {
            accessorKey: "attachment",
            header: () => <div className="text-center">Attachment</div>,
            cell: ({ row }) => (
                <div className="flex justify-center">
                    {row.original.attachment ? (
                        <a
                            href={row.original.attachment}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 bg-blue-50 text-blue-600 rounded-md hover:bg-blue-100 transition-colors"
                        >
                            <ExternalLink className="h-4 w-4" />
                        </a>
                    ) : (
                        <span className="text-xs text-gray-400">--</span>
                    )}
                </div>
            ),
        },
        {
            id: "actions",
            header: () => <div className="text-center">Actions</div>,
            cell: ({ row }) => (
                <div className="flex justify-center">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={() => handleEditClick(row.original)}
                    >
                        <Edit className="h-4 w-4" />
                    </Button>
                </div>
            ),
        },
    ];
};

export const TaskWiseTable: React.FC<TaskWiseTableProps> = ({ statusFilter }) => {
    const [editingTask, setEditingTask] = useState<FlattenedPMOTask | null>(null);
    const [editOpen, setEditOpen] = useState(false);

    const handleEditClick = (task: FlattenedPMOTask) => {
        setEditingTask(task);
        setEditOpen(true);
    };

    // Fetch distinct project IDs that have PMO tasks
    const { data: pmoTaskProjects } = useFrappeGetDocList("PMO Project Task", {
        fields: ["project"],
        groupBy: "project",
        limit: 1000,
    }, "pmo-task-wise-project-ids");

    // Fetch project names for those project IDs
    const projectFilters = useMemo(() => {
        if (!pmoTaskProjects?.length) return null;
        const ids = pmoTaskProjects.map((p) => p.project).filter(Boolean);
        return ids.length ? [["name", "in", ids]] : null;
    }, [pmoTaskProjects]);

    const { data: projectsData } = useFrappeGetDocList("Projects", {
        fields: ["name", "project_name"],
        filters: projectFilters as any,
        limit: 1000,
        orderBy: { field: "project_name", order: "asc" },
    }, projectFilters ? `pmo-task-wise-projects-${JSON.stringify(projectFilters)}` : null);

    const projectOptions = useMemo(() => {
        return projectsData?.map((p) => ({ label: p.project_name, value: p.project_name })) || [];
    }, [projectsData]);

    // Fetch distinct categories for facet filter
    const { data: categoriesData } = useFrappeGetDocList("PMO Task Category", {
        fields: ["category_name"],
        limit: 1000,
        orderBy: { field: "creation", order: "asc" },
    }, "pmo-task-wise-categories");

    // Fetch distinct task names for facet filter
    const { data: taskMastersData } = useFrappeGetDocList("PMO Task Master", {
        fields: ["task_name"],
        limit: 1000,
        orderBy: { field: "creation", order: "asc" },
    }, "pmo-task-wise-task-masters");

    const facetFilterOptions = useMemo(() => ({
        project_name: {
            title: "Project Name",
            options: projectOptions,
        },
        category: {
            title: "Category",
            options: categoriesData?.map((c) => ({ label: c.category_name, value: c.category_name })) || [],
        },
        task_name: {
            title: "Task Name",
            options: taskMastersData?.map((t) => ({ label: t.task_name, value: t.task_name })) || [],
        },
        status: {
            title: "Status",
            options: [
                { label: "Not Defined", value: "Not Defined" },
                { label: "WIP", value: "WIP" },
                { label: "Sent/Submission", value: "Sent/Submision" },
                { label: "Completed", value: "Approve by client" },
            ],
        },
    }), [projectOptions, categoriesData, taskMastersData]);

    const additionalFilters = useMemo(() => {
        const filters: any[] = [];
        if (statusFilter && statusFilter !== "All") {
            filters.push(["PMO Project Task", "status", "=", statusFilter]);
        }
        return filters;
    }, [statusFilter]);

    const serverDataTable = useServerDataTable<FlattenedPMOTask>({
        doctype: "PMO Project Task",
        apiEndpoint: "nirmaan_stack.api.pmo_dashboard.get_all_tasks",
        columns: useMemo(() => getTaskWiseColumns(handleEditClick), []),
        fetchFields: [
            "name",
            "task_name",
            "category",
            "status",
            "expected_completion_date",
            "completion_date",
            "attachment",
            "project",
        ],
        searchableFields: [
            { value: "task_name", label: "Task Name", default: true },
            { value: "project_name", label: "Project Name" },
            { value: "category", label: "Category" },
        ],
        defaultSort: "expected_completion_date asc",
        urlSyncKey: "pmo_task_wise",
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

    return (
        <div className="space-y-4">
            {serverDataTable.isLoading && !serverDataTable.data?.length ? (
                <TableSkeleton />
            ) : (
                <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                    <DataTable<FlattenedPMOTask>
                        table={table}
                        columns={table.options.columns}
                        isLoading={serverDataTable.isLoading}
                        error={serverDataTable.error}
                        totalCount={serverDataTable.totalCount}
                        searchFieldOptions={[
                            { value: "task_name", label: "Task Name", default: true },
                            { value: "project_name", label: "Project Name" },
                            { value: "category", label: "Category" },
                        ]}
                        selectedSearchField={serverDataTable.selectedSearchField}
                        onSelectedSearchFieldChange={serverDataTable.setSelectedSearchField}
                        facetFilterOptions={facetFilterOptions}
                        dateFilterColumns={["expected_completion_date"]}
                        searchTerm={serverDataTable.searchTerm}
                        onSearchTermChange={serverDataTable.setSearchTerm}
                        showExportButton={true}
                        exportFileName="PMO_Global_Tasks"
                        onExport="default"
                        tableHeight="65vh"
                    />
                </div>
            )}

            {editingTask && (
                <EditTaskModal
                    open={editOpen}
                    onOpenChange={setEditOpen}
                    task={editingTask as any}
                    onSuccess={() => {
                        serverDataTable.refetch();
                        setEditingTask(null);
                    }}
                />
            )}
        </div>
    );
};
