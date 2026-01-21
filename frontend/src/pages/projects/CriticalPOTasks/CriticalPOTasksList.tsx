import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CriticalPOTask } from "@/types/NirmaanStack/CriticalPOTasks";
import { TaskStatusBadge } from "./components/TaskStatusBadge";
import { EditTaskDialog } from "./components/EditTaskDialog";
import { LinkedPOsColumn } from "./components/LinkedPOsColumn";
import { LinkPODialog } from "./components/LinkPODialog";
import { formatDate } from "@/utils/FormatDate";
import {
    Settings2,
    ChevronRight,
    MoreVertical,
    ChevronDown,
    CheckCircle2,
} from "lucide-react";

// DataTable imports
import { DataTable } from "@/components/data-table/new-data-table";
import {
    useReactTable,
    getCoreRowModel,
    getFilteredRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    getFacetedRowModel,
    getFacetedUniqueValues,
    ColumnFiltersState,
    SortingState,
    PaginationState,
} from "@tanstack/react-table";
import { ProgressCircle } from "@/components/ui/ProgressCircle";
import { getTaskTableColumns, TASK_DATE_COLUMNS } from "./config/taskTableColumns";
import {
    calculateTaskStats,
    getProgressColor,
    getStatusBadgeVariant,
    CRITICAL_PO_STATUS_OPTIONS,
    parseAssociatedPOs,
} from "./utils";

// Mobile Card Component for tasks
interface TaskMobileCardProps {
    task: CriticalPOTask;
    projectId: string;
    mutate: () => Promise<any>;
    canEdit: boolean;
}

const TaskMobileCard: React.FC<TaskMobileCardProps> = ({ task, projectId, mutate, canEdit }) => {
    const [isOpen, setIsOpen] = useState(false);

    const linkedPOsCount = React.useMemo(() => {
        return parseAssociatedPOs(task.associated_pos).length;
    }, [task.associated_pos]);

    return (
        <Card className="p-3">
            {/* Header: Category badge + Item name + Actions */}
            <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                    {/* Category badge first, then item name */}
                    <div className="flex flex-wrap gap-1 mb-1.5">
                        <Badge variant="outline" className="text-xs">
                            {task.critical_po_category}
                        </Badge>
                        {task.sub_category && (
                            <Badge variant="secondary" className="text-xs">
                                {task.sub_category}
                            </Badge>
                        )}
                    </div>
                    <h4 className="font-medium text-sm leading-tight">{task.item_name}</h4>
                    <div className="mt-1.5">
                        <TaskStatusBadge status={task.status} />
                    </div>
                </div>
                {canEdit && (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                <MoreVertical className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <EditTaskDialog task={task} projectId={projectId} mutate={mutate} />
                            <LinkPODialog task={task} projectId={projectId} mutate={mutate} />
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
            </div>

            {/* Deadline info */}
            <div className="mt-2 text-xs text-muted-foreground space-y-0.5">
                <div className="flex items-center gap-1">
                    <span className="text-gray-500">Deadline:</span>
                    <span className="font-medium">{formatDate(task.po_release_date)}</span>
                </div>
                {task.revised_date && (
                    <div className="flex items-center gap-1">
                        <span className="text-amber-600">Revised:</span>
                        <span className="font-medium text-amber-700">{formatDate(task.revised_date)}</span>
                    </div>
                )}
            </div>

            {/* Remarks (if any) */}
            {task.remarks && (
                <div className="mt-2 text-xs text-gray-500 bg-gray-50 rounded p-2">
                    {task.remarks}
                </div>
            )}

            {/* Associated POs - collapsible section */}
            {linkedPOsCount > 0 && (
                <Collapsible open={isOpen} onOpenChange={setIsOpen} className="mt-2 pt-2 border-t">
                    <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-full">
                        <ChevronRight className={`h-3 w-3 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                        <span>Show {linkedPOsCount} linked PO{linkedPOsCount > 1 ? "s" : ""}</span>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-2">
                        <LinkedPOsColumn task={task} projectId={projectId} mutate={mutate} canDelete={canEdit} />
                    </CollapsibleContent>
                </Collapsible>
            )}
        </Card>
    );
};

interface CriticalPOTasksListProps {
    tasks: CriticalPOTask[];
    projectId: string;
    mutate: () => Promise<any>;
    onManageSetup?: () => void;
    canEdit?: boolean;
}

export const CriticalPOTasksList: React.FC<CriticalPOTasksListProps> = ({
    tasks,
    projectId,
    mutate,
    onManageSetup,
    canEdit = false,
}) => {
    // Mobile summary accordion state
    const [isMobileSummaryOpen, setIsMobileSummaryOpen] = useState(false);

    // DataTable state
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedSearchField, setSelectedSearchField] = useState("item_name");
    const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
    const [sorting, setSorting] = useState<SortingState>([{ id: "po_release_date", desc: false }]);
    const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 50 });

    // Edit task state (for controlled dialog from table row)
    const [editingTask, setEditingTask] = useState<CriticalPOTask | null>(null);

    // Calculate progress statistics
    const { totalTasks, releasedTasks, completionPercentage, statusCounts } = useMemo(
        () => calculateTaskStats(tasks),
        [tasks]
    );

    const progressColor = getProgressColor(completionPercentage);

    // Get unique categories for filter
    const uniqueCategories = useMemo(() => {
        const categories = new Set(tasks.map((task) => task.critical_po_category));
        return Array.from(categories).sort().map((cat) => ({ label: cat, value: cat }));
    }, [tasks]);

    // Faceted filter options
    const facetFilterOptions = useMemo(
        () => ({
            critical_po_category: {
                title: "Category",
                options: uniqueCategories,
            },
            status: {
                title: "Status",
                options: CRITICAL_PO_STATUS_OPTIONS,
            },
        }),
        [uniqueCategories]
    );

    // Search field options
    const searchFieldOptions = [
        { value: "item_name", label: "Item Name", default: true },
        { value: "critical_po_category", label: "Category" },
        { value: "sub_category", label: "Sub Category" },
    ];

    // Column definitions
    const columns = useMemo(
        () => getTaskTableColumns(setEditingTask, canEdit),
        [canEdit]
    );

    // TanStack Table instance
    const table = useReactTable({
        data: tasks,
        columns,
        state: {
            columnFilters,
            sorting,
            pagination,
            globalFilter: searchTerm,
        },
        onColumnFiltersChange: setColumnFilters,
        onSortingChange: setSorting,
        onPaginationChange: setPagination,
        onGlobalFilterChange: setSearchTerm,
        getCoreRowModel: getCoreRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        getFacetedRowModel: getFacetedRowModel(),
        getFacetedUniqueValues: getFacetedUniqueValues(),
        globalFilterFn: (row, _columnId, filterValue) => {
            const searchValue = filterValue.toLowerCase();
            const fieldValue = row.getValue(selectedSearchField);
            if (typeof fieldValue === "string") {
                return fieldValue.toLowerCase().includes(searchValue);
            }
            return false;
        },
    });

    // Get filtered tasks for mobile view
    const filteredTasks = table.getFilteredRowModel().rows.map((row) => row.original);

    // Project name for export filename
    const projectName = tasks[0]?.project_name?.replace(/[^a-zA-Z0-9]/g, "_") || "Project";

    return (
        <div className="flex-1 md:space-y-4">
            {/* Summary Header Section */}
            <div className="bg-white border-b border-gray-200 md:border md:rounded-lg">
                {/* Mobile View: Collapsible Summary */}
                <div className="sm:hidden">
                    <Collapsible open={isMobileSummaryOpen} onOpenChange={setIsMobileSummaryOpen}>
                        <div className="px-4 py-3 flex items-center justify-between">
                            <div className="flex flex-col gap-0.5">
                                <span className="text-[10px] font-medium uppercase tracking-wider text-gray-400">
                                    Critical PO Tasks
                                </span>
                                <h1 className="text-base font-semibold text-gray-900">
                                    {totalTasks} Task{totalTasks !== 1 ? "s" : ""}
                                </h1>
                            </div>
                            <CollapsibleTrigger asChild>
                                <button className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100 transition-colors">
                                    <span>Details</span>
                                    <ChevronDown
                                        className={`h-4 w-4 transition-transform duration-200 ${
                                            isMobileSummaryOpen ? "rotate-180" : ""
                                        }`}
                                    />
                                </button>
                            </CollapsibleTrigger>
                        </div>

                        <CollapsibleContent>
                            <div className="px-4 pb-3 space-y-3 border-t border-gray-100">
                                {/* Mobile Progress Summary */}
                                {totalTasks > 0 && (
                                    <div className="pt-3">
                                        <div className="flex items-center gap-3">
                                            <ProgressCircle
                                                value={completionPercentage}
                                                className={`size-12 flex-shrink-0 ${progressColor}`}
                                                textSizeClassName="text-[10px]"
                                            />
                                            <div>
                                                <div className="flex items-center gap-1 mb-0.5">
                                                    <CheckCircle2 className="h-3 w-3 text-green-600" />
                                                    <span className="text-[10px] text-gray-500">Released</span>
                                                </div>
                                                <span className={`text-lg font-bold ${progressColor}`}>
                                                    {releasedTasks}/{totalTasks}
                                                </span>
                                            </div>
                                        </div>

                                        {/* Status breakdown */}
                                        <div className="flex flex-wrap gap-1.5 mt-2">
                                            {Object.entries(statusCounts)
                                                .filter(([status]) => status !== "Released")
                                                .filter(([, count]) => count > 0)
                                                .map(([status, count]) => (
                                                    <Badge
                                                        key={status}
                                                        variant="outline"
                                                        className={`text-[10px] px-1.5 py-0.5 ${getStatusBadgeVariant(status)}`}
                                                    >
                                                        {status}: {count}
                                                    </Badge>
                                                ))}
                                        </div>
                                    </div>
                                )}

                                {/* Action Button */}
                                {onManageSetup && (
                                    <div className="pt-2 border-t border-gray-50">
                                        <Button variant="outline" onClick={onManageSetup} size="sm" className="w-full">
                                            <Settings2 className="h-4 w-4 mr-2" />
                                            Manage Setup
                                        </Button>
                                    </div>
                                )}
                            </div>
                        </CollapsibleContent>
                    </Collapsible>
                </div>

                {/* Desktop View: Static Summary */}
                <div className="hidden sm:block px-4 py-4 md:px-6">
                    {/* Row 1: Title + Action */}
                    <div className="flex items-center justify-between">
                        <div className="flex flex-col gap-0.5">
                            <span className="text-[10px] font-medium uppercase tracking-wider text-gray-400">
                                Critical PO Tasks
                            </span>
                            <h1 className="text-lg font-semibold text-gray-900">
                                {totalTasks} Task{totalTasks !== 1 ? "s" : ""}
                            </h1>
                        </div>
                        {onManageSetup && (
                            <Button variant="outline" onClick={onManageSetup} size="sm">
                                <Settings2 className="h-4 w-4 mr-2" />
                                Manage Setup
                            </Button>
                        )}
                    </div>

                    {/* Row 2: Progress Summary */}
                    {totalTasks > 0 && (
                        <div className="flex items-center gap-6 py-4 mt-3 border-t border-gray-100">
                            {/* Progress Circle + Completion Counter */}
                            <div className="flex items-center gap-4">
                                <ProgressCircle
                                    value={completionPercentage}
                                    className={`size-16 flex-shrink-0 ${progressColor}`}
                                    textSizeClassName="text-sm font-semibold"
                                />

                                <div>
                                    <div className="flex items-center gap-1.5 mb-1">
                                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                                        <span className="text-sm text-gray-500">POs Released</span>
                                    </div>
                                    <div className="flex items-baseline gap-1">
                                        <span className={`text-3xl font-bold tabular-nums ${progressColor}`}>
                                            {releasedTasks}
                                        </span>
                                        <span className="text-xl text-gray-400 font-medium">/</span>
                                        <span className="text-xl text-gray-500 font-semibold tabular-nums">
                                            {totalTasks}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* Status Breakdown */}
                            <div className="flex-1 flex flex-wrap gap-2 justify-end">
                                {Object.entries(statusCounts)
                                    .filter(([status]) => status !== "Released")
                                    .filter(([, count]) => count > 0)
                                    .map(([status, count]) => (
                                        <div
                                            key={status}
                                            className={`flex items-center gap-2 px-3 py-1.5 rounded-md ${getStatusBadgeVariant(status)}`}
                                        >
                                            <span className="text-xs font-medium">{status}</span>
                                            <span className="text-sm font-bold tabular-nums">{count}</span>
                                        </div>
                                    ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Mobile View: Card-based layout */}
            <div className="sm:hidden p-4 space-y-3">
                {filteredTasks.length === 0 ? (
                    <div className="text-center py-10 text-gray-500">
                        <p>No tasks found matching your filters.</p>
                    </div>
                ) : (
                    filteredTasks.map((task) => (
                        <TaskMobileCard
                            key={task.name}
                            task={task}
                            projectId={projectId}
                            mutate={mutate}
                            canEdit={canEdit}
                        />
                    ))
                )}
            </div>

            {/* Desktop View: DataTable */}
            <div className="hidden sm:block p-4 md:px-0 overflow-x-auto">
                <DataTable<CriticalPOTask>
                    table={table}
                    columns={columns}
                    isLoading={false}
                    totalCount={table.getFilteredRowModel().rows.length}
                    searchFieldOptions={searchFieldOptions}
                    selectedSearchField={selectedSearchField}
                    onSelectedSearchFieldChange={setSelectedSearchField}
                    searchTerm={searchTerm}
                    onSearchTermChange={setSearchTerm}
                    facetFilterOptions={facetFilterOptions}
                    dateFilterColumns={TASK_DATE_COLUMNS}
                    showExportButton={true}
                    exportFileName={`${projectName}_Critical_PO_Tasks`}
                    onExport="default"
                    tableHeight="60vh"
                />
            </div>

            {/* Edit Task Dialog (controlled mode for table row clicks) */}
            {editingTask && (
                <EditTaskDialog
                    task={editingTask}
                    projectId={projectId}
                    mutate={mutate}
                    open={!!editingTask}
                    onOpenChange={(open) => {
                        if (!open) setEditingTask(null);
                    }}
                />
            )}
        </div>
    );
};
