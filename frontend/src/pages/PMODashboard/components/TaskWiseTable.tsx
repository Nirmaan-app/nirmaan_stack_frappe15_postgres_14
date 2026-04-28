import React, { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
    ColumnDef,
    getCoreRowModel,
    getFacetedRowModel,
    getFacetedUniqueValues,
    useReactTable,
    RowSelectionState,
} from "@tanstack/react-table";
import { Edit, ExternalLink, Users, UserCheck } from "lucide-react";
import { useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { TableSkeleton } from "@/components/ui/skeleton";
import { DataTable } from "@/components/data-table/new-data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { useServerDataTable } from "@/hooks/useServerDataTable";
import { safeFormatDate } from "@/lib/utils";
import { useUserData } from "@/hooks/useUserData";
import { toast } from "@/components/ui/use-toast";
import { parseAssignedFromField, type AssignedPMODetail } from "../utils";
import EditTaskModal from "./EditTaskModal";
import { AssignPMODialog } from "./AssignPMODialog";

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
    assigned_to?: string | null;
}

interface TaskWiseTableProps {
    statusFilter?: string;
}

const getTaskWiseColumns = (
    handleEditClick: (task: FlattenedPMOTask) => void,
    isAdmin: boolean,
    isPMO: boolean,
    userId: string,
): ColumnDef<FlattenedPMOTask>[] => {
    const cols: ColumnDef<FlattenedPMOTask>[] = [];

    // Row selection checkbox (admin only)
    if (isAdmin) {
        cols.push({
            id: "select",
            header: ({ table }) => (
                <Checkbox
                    checked={table.getIsAllPageRowsSelected()}
                    onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
                    aria-label="Select all"
                    className="translate-y-[2px]"
                />
            ),
            cell: ({ row }) => (
                <Checkbox
                    checked={row.getIsSelected()}
                    onCheckedChange={(value) => row.toggleSelected(!!value)}
                    aria-label="Select row"
                    className="translate-y-[2px]"
                />
            ),
            enableSorting: false,
            enableHiding: false,
            size: 40,
        });
    }

    cols.push(
        {
            accessorKey: "project_name",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
            cell: ({ row }) => (
                <Link
                    to={`/pmo-dashboard/${row.original.project}`}
                    className="text-red-700 underline-offset-2 hover:underline font-medium truncate block"
                >
                    {row.original.project_name}
                </Link>
            ),
            enableColumnFilter: true,
            size: 140,
            minSize: 100,
        },
        {
            accessorKey: "category",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Category" />,
            cell: ({ row }) => (
                <span className="truncate block">{row.original.category}</span>
            ),
            enableColumnFilter: true,
            size: 120,
            minSize: 90,
        },
        {
            accessorKey: "task_name",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Task Name" />,
            cell: ({ row }) => (
                <span className="truncate block">{row.original.task_name}</span>
            ),
            enableColumnFilter: true,
            size: 150,
            minSize: 100,
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
                    <span className={`whitespace-nowrap ${isOverdue ? "text-red-600 font-semibold" : ""}`}>
                        {safeFormatDate(date)}
                    </span>
                );
            },
            size: 110,
            minSize: 95,
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
                    <Badge variant="outline" className={`${colorClass} border-none whitespace-nowrap`}>
                        {status}
                    </Badge>
                );
            },
            enableColumnFilter: true,
            size: 100,
            minSize: 80,
        },
        {
            id: "assigned_to",
            accessorKey: "assigned_to",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Assigned To" />,
            cell: ({ row }) => {
                const assigned = parseAssignedFromField(row.original.assigned_to);
                if (assigned.length === 0) {
                    return <span className="text-xs text-gray-400">--</span>;
                }
                return (
                    <div className="flex flex-wrap gap-0.5">
                        {assigned.map((d, idx) => (
                            <Badge
                                key={idx}
                                variant="secondary"
                                className="px-1.5 py-0 text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-200 rounded-full whitespace-nowrap"
                            >
                                {d.userName || d.userId}
                            </Badge>
                        ))}
                    </div>
                );
            },
            enableColumnFilter: true,
            size: 120,
            minSize: 90,
        },
        {
            accessorKey: "attachment",
            header: () => <div className="text-center">Attach</div>,
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
            size: 60,
            minSize: 50,
        },
        {
            id: "actions",
            header: () => <div className="text-center">Actions</div>,
            cell: ({ row }) => {
                const canEdit = !isPMO || (() => {
                    const assigned = parseAssignedFromField(row.original.assigned_to);
                    return assigned.some((d) => d.userId === userId);
                })();

                return (
                    <div className="flex justify-center">
                        <Button
                            variant="ghost"
                            size="sm"
                            className={`h-8 w-8 p-0 ${!canEdit ? "text-gray-300 cursor-not-allowed" : ""}`}
                            disabled={!canEdit}
                            onClick={() => canEdit && handleEditClick(row.original)}
                        >
                            <Edit className="h-4 w-4" />
                        </Button>
                    </div>
                );
            },
            size: 60,
            minSize: 50,
        },
    );

    return cols;
};

export const TaskWiseTable: React.FC<TaskWiseTableProps> = ({ statusFilter }) => {
    const { user_id, role } = useUserData();
    const isAdmin = role === "Nirmaan Admin Profile" || user_id === "Administrator";
    const isPMO = role === "Nirmaan PMO Executive Profile";

    const [editingTask, setEditingTask] = useState<FlattenedPMOTask | null>(null);
    const [editOpen, setEditOpen] = useState(false);
    const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
    const [showMyTasksOnly, setShowMyTasksOnly] = useState(isPMO);
    const [assignDialogOpen, setAssignDialogOpen] = useState(false);

    const handleEditClick = (task: FlattenedPMOTask) => {
        setEditingTask(task);
        setEditOpen(true);
    };

    // Fetch PMO users for assign dialog + facet filter
    const { call: fetchPMOUsers } = useFrappePostCall(
        "nirmaan_stack.api.pmo_dashboard.get_pmo_users"
    );
    const [pmoUsers, setPmoUsers] = useState<{ user_id: string; full_name: string; email: string }[]>([]);
    const [pmoUsersLoaded, setPmoUsersLoaded] = useState(false);

    const loadPMOUsers = useCallback(async () => {
        if (pmoUsersLoaded) return;
        try {
            const res = await fetchPMOUsers({});
            setPmoUsers(res?.message || []);
            setPmoUsersLoaded(true);
        } catch {
            // silent fail
        }
    }, [fetchPMOUsers, pmoUsersLoaded]);

    // Load PMO users on mount for the facet filter
    React.useEffect(() => {
        loadPMOUsers();
    }, [loadPMOUsers]);

    // Assign API
    const { call: assignCall } = useFrappePostCall(
        "nirmaan_stack.api.pmo_dashboard.assign_pmo_tasks"
    );

    // Use the same projects shown as cards in Project-Wise tab:
    // active (disabled_pmo === 0) and status not "Completed"
    const { call: fetchPmoProjects } = useFrappePostCall(
        "nirmaan_stack.api.pmo_dashboard.get_pmo_projects"
    );
    const [pmoProjectsList, setPmoProjectsList] = useState<{ name: string; project_name: string; status: string; disabled_pmo: 0 | 1 }[]>([]);

    React.useEffect(() => {
        fetchPmoProjects({}).then((res: any) => {
            setPmoProjectsList(res?.message || []);
        });
    }, [fetchPmoProjects]);

    const projectOptions = useMemo(() => {
        return pmoProjectsList
            .filter((p) => p.disabled_pmo === 0 && p.status !== "Completed")
            .sort((a, b) => (a.project_name || "").localeCompare(b.project_name || ""))
            .map((p) => ({ label: p.project_name, value: p.project_name }));
    }, [pmoProjectsList]);

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

    const assignedFilterOptions = useMemo(() => {
        return pmoUsers.map((u) => ({ label: u.full_name || u.user_id, value: u.user_id }));
    }, [pmoUsers]);

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
        assigned_to: {
            title: "Assigned To",
            options: assignedFilterOptions,
        },
    }), [projectOptions, categoriesData, taskMastersData, assignedFilterOptions]);

    const additionalFilters = useMemo(() => {
        const filters: any[] = [];
        if (statusFilter && statusFilter !== "All") {
            filters.push(["PMO Project Task", "status", "=", statusFilter]);
        }
        // "My Tasks" toggle filters to assigned tasks
        if (showMyTasksOnly && isPMO && user_id) {
            filters.push(["PMO Project Task", "assigned_to", "=", user_id]);
        }
        return filters;
    }, [statusFilter, showMyTasksOnly, isPMO, user_id]);

    const serverDataTable = useServerDataTable<FlattenedPMOTask>({
        doctype: "PMO Project Task",
        apiEndpoint: "nirmaan_stack.api.pmo_dashboard.get_all_tasks",
        columns: useMemo(() => getTaskWiseColumns(handleEditClick, isAdmin, isPMO, user_id), [isAdmin, isPMO, user_id]),
        fetchFields: [
            "name",
            "task_name",
            "category",
            "status",
            "expected_completion_date",
            "completion_date",
            "attachment",
            "project",
            "assigned_to",
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
            rowSelection: isAdmin ? rowSelection : {},
        },
        onPaginationChange: serverDataTable.setPagination,
        onSortingChange: serverDataTable.setSorting,
        onColumnFiltersChange: serverDataTable.setColumnFilters,
        onGlobalFilterChange: serverDataTable.setSearchTerm,
        onRowSelectionChange: isAdmin ? setRowSelection : undefined,
        enableRowSelection: isAdmin,
        getFacetedRowModel: getFacetedRowModel(),
        getFacetedUniqueValues: getFacetedUniqueValues(),
    });

    const selectedRows = table.getFilteredSelectedRowModel().rows;
    const selectedTasks = selectedRows.map((r) => r.original);

    const handleBulkAssign = async (taskNames: string[], assignedTo: AssignedPMODetail[]) => {
        try {
            await assignCall({
                task_names: JSON.stringify(taskNames),
                assigned_to: JSON.stringify(assignedTo),
            });
            toast({
                title: "Success",
                description: `Assigned ${taskNames.length} task(s) successfully.`,
                variant: "success",
            });
            setRowSelection({});
            serverDataTable.refetch();
        } catch (error: any) {
            toast({
                title: "Error",
                description: error.message || "Failed to assign tasks.",
                variant: "destructive",
            });
        }
    };

    const openAssignDialog = async () => {
        await loadPMOUsers();
        setAssignDialogOpen(true);
    };

    return (
        <div className="space-y-4">
            {/* My Tasks toggle (PMO) + Bulk Assign button (Admin) */}
            <div className="flex items-center gap-2 flex-wrap">
                {isPMO && (
                    <button
                        onClick={() => setShowMyTasksOnly(!showMyTasksOnly)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all border ${
                            showMyTasksOnly
                                ? "bg-blue-600 text-white border-transparent shadow-sm"
                                : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                        }`}
                    >
                        <UserCheck className="h-3.5 w-3.5" />
                        <span>My Tasks</span>
                    </button>
                )}

                {isAdmin && selectedTasks.length > 0 && (
                    <Button
                        size="sm"
                        variant="outline"
                        className="border-red-300 text-red-700 hover:bg-red-50"
                        onClick={openAssignDialog}
                    >
                        <Users className="h-3.5 w-3.5 mr-1.5" />
                        BulkAssign ({selectedTasks.length})
                    </Button>
                )}
            </div>

            {serverDataTable.isLoading && !serverDataTable.data?.length ? (
                <TableSkeleton />
            ) : (
                <div>
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

            {isAdmin && (
                <AssignPMODialog
                    isOpen={assignDialogOpen}
                    onOpenChange={setAssignDialogOpen}
                    selectedTasks={selectedTasks}
                    pmoUsers={pmoUsers}
                    onAssign={handleBulkAssign}
                />
            )}
        </div>
    );
};
