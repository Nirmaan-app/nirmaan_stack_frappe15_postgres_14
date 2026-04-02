// frontend/src/pages/CommissionReport/config/taskTableColumns.tsx

import { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Edit } from "lucide-react";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { CommissionReportTask } from "../types";
import {
    getUnifiedStatusStyle,
    formatDeadlineShort,
    getAssignedNameForDisplay,
    parseDesignersFromField
} from "../utils";
import { FilesCell } from "../components/FilesCell";

// Column IDs that support date filtering
export const TASK_DATE_COLUMNS = ["deadline"];

// Custom filter function for faceted (multi-select) filters
const facetedFilterFn = (row: any, columnId: string, filterValue: string[]) => {
    if (!filterValue || filterValue.length === 0) return true;
    const cellValue = row.getValue(columnId);
    return filterValue.includes(cellValue);
};

// Custom filter function for assigned_designers (multi-select by userId)
const assignedDesignersFilterFn = (row: any, _columnId: string, filterValue: string[]) => {
    if (!filterValue || filterValue.length === 0) return true;
    const designerField = row.original.assigned_designers;
    const designers = parseDesignersFromField(designerField);
    const designerIds = designers.map(d => d.userId);
    return filterValue.some(id => designerIds.includes(id));
};

// Helper to get date range for timespan values
const getTimespanDateRange = (timespan: string): { start: Date; end: Date } => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endOfDay = new Date(today);
    endOfDay.setHours(23, 59, 59, 999);

    switch (timespan) {
        case 'today':
            return { start: today, end: endOfDay };
        case 'yesterday': {
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            const endYesterday = new Date(yesterday);
            endYesterday.setHours(23, 59, 59, 999);
            return { start: yesterday, end: endYesterday };
        }
        case 'this week': {
            const startOfWeek = new Date(today);
            startOfWeek.setDate(today.getDate() - today.getDay());
            return { start: startOfWeek, end: endOfDay };
        }
        case 'last week': {
            const startOfLastWeek = new Date(today);
            startOfLastWeek.setDate(today.getDate() - today.getDay() - 7);
            const endOfLastWeek = new Date(startOfLastWeek);
            endOfLastWeek.setDate(startOfLastWeek.getDate() + 6);
            endOfLastWeek.setHours(23, 59, 59, 999);
            return { start: startOfLastWeek, end: endOfLastWeek };
        }
        case 'this month': {
            const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
            return { start: startOfMonth, end: endOfDay };
        }
        case 'last month': {
            const startOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
            const endOfLastMonth = new Date(today.getFullYear(), today.getMonth(), 0);
            endOfLastMonth.setHours(23, 59, 59, 999);
            return { start: startOfLastMonth, end: endOfLastMonth };
        }
        case 'this quarter': {
            const quarter = Math.floor(today.getMonth() / 3);
            const startOfQuarter = new Date(today.getFullYear(), quarter * 3, 1);
            return { start: startOfQuarter, end: endOfDay };
        }
        case 'last quarter': {
            const quarter = Math.floor(today.getMonth() / 3);
            const startOfLastQuarter = new Date(today.getFullYear(), (quarter - 1) * 3, 1);
            const endOfLastQuarter = new Date(today.getFullYear(), quarter * 3, 0);
            endOfLastQuarter.setHours(23, 59, 59, 999);
            return { start: startOfLastQuarter, end: endOfLastQuarter };
        }
        case 'this year': {
            const startOfYear = new Date(today.getFullYear(), 0, 1);
            return { start: startOfYear, end: endOfDay };
        }
        case 'last year': {
            const startOfLastYear = new Date(today.getFullYear() - 1, 0, 1);
            const endOfLastYear = new Date(today.getFullYear() - 1, 11, 31);
            endOfLastYear.setHours(23, 59, 59, 999);
            return { start: startOfLastYear, end: endOfLastYear };
        }
        case 'last 6 months': {
            const sixMonthsAgo = new Date(today);
            sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
            return { start: sixMonthsAgo, end: endOfDay };
        }
        case 'last 7 days': {
            const sevenDaysAgo = new Date(today);
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
            return { start: sevenDaysAgo, end: endOfDay };
        }
        case 'last 14 days': {
            const fourteenDaysAgo = new Date(today);
            fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
            return { start: fourteenDaysAgo, end: endOfDay };
        }
        case 'last 30 days': {
            const thirtyDaysAgo = new Date(today);
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            return { start: thirtyDaysAgo, end: endOfDay };
        }
        case 'last 90 days': {
            const ninetyDaysAgo = new Date(today);
            ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
            return { start: ninetyDaysAgo, end: endOfDay };
        }
        default:
            return { start: today, end: endOfDay };
    }
};

// Custom filter function for date filters
interface DateFilterValue {
    operator: string;
    value: string | string[] | null;
}

const dateFilterFn = (row: any, columnId: string, filterValue: DateFilterValue) => {
    if (!filterValue || !filterValue.value) return true;

    const cellValue = row.getValue(columnId);
    if (!cellValue) return false;

    const cellDate = new Date(cellValue + 'T00:00:00');
    if (isNaN(cellDate.getTime())) return false;

    const { operator, value } = filterValue;

    switch (operator) {
        case 'Is': {
            const filterDate = new Date(value as string + 'T00:00:00');
            return cellDate.toDateString() === filterDate.toDateString();
        }
        case 'Between': {
            if (!Array.isArray(value) || value.length !== 2) return true;
            const startDate = new Date(value[0] + 'T00:00:00');
            const endDate = new Date(value[1] + 'T23:59:59');
            return cellDate >= startDate && cellDate <= endDate;
        }
        case '<=': {
            const filterDate = new Date(value as string + 'T23:59:59');
            return cellDate <= filterDate;
        }
        case '>=': {
            const filterDate = new Date(value as string + 'T00:00:00');
            return cellDate >= filterDate;
        }
        case 'Timespan': {
            const range = getTimespanDateRange(value as string);
            return cellDate >= range.start && cellDate <= range.end;
        }
        default:
            return true;
    }
};

// Column definitions factory
export const getTaskTableColumns = (
    handleEditClick: (task: CommissionReportTask) => void,
    isRestrictedUser: boolean,
    checkIfUserAssigned: (task: CommissionReportTask) => boolean
): ColumnDef<CommissionReportTask>[] => {
    return [
        {
            accessorKey: "commission_category",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Category" />,
            cell: ({ row }) => (
                <span className="text-xs truncate block max-w-[90px]">{row.original.commission_category || '--'}</span>
            ),
            enableColumnFilter: true,
            filterFn: facetedFilterFn,
            size: 140,
            minSize: 100,
            maxSize: 180,
        },
        {
            accessorKey: "task_name",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Report Name" />,
            cell: ({ row }) => (
                <span className="font-medium text-gray-900 text-xs truncate block max-w-[250px]">{row.original.task_name}</span>
            ),
            size: 190,
            minSize: 150,
            maxSize: 280,
        },
        // Conditionally show Assigned Designer column (hidden for restricted assignee roles)
        ...(isRestrictedUser ? [] : [{
            id: "assigned_designers",
            accessorKey: "assigned_designers",
            header: ({ column }: { column: any }) => (
                <DataTableColumnHeader column={column} title="Assigned" />
            ),
            cell: ({ row }: { row: any }) => (
                <div className="py-0.5">
                    {getAssignedNameForDisplay(row.original)}
                </div>
            ),
            enableColumnFilter: true,
            filterFn: assignedDesignersFilterFn,
            size: 160,
            minSize: 130,
            maxSize: 200,
            meta: {
                exportHeaderName: "Assigned Designers",
                exportValue: (row: CommissionReportTask) => {
                    const designers = parseDesignersFromField(row.assigned_designers);
                    return designers.map(d => `• ${d.userName || d.userId}`).join("\n");
                }
            }
        }] as ColumnDef<CommissionReportTask>[]),
        {
            id: "deadline",
            accessorKey: "deadline",
            header: ({ column }) => (
                <div className="flex justify-center"> 
                <DataTableColumnHeader column={column} title="Deadline" />
                </div>
                ),
            cell: ({ row }) => (
                <span className={`text-xs ${row.original.deadline ? "" : "text-gray-400"}`}>
                    {row.original.deadline ? formatDeadlineShort(row.original.deadline) : '--'}
                </span>
            ),
            enableColumnFilter: true,
            filterFn: dateFilterFn,
            size: 110,
            minSize: 90,
            maxSize: 130,
        },
        {
            accessorKey: "task_status",
            header: ({ column }) => (
                <div className="flex justify-center px-3">
                    <DataTableColumnHeader column={column} title="Status" />
                </div>
            ),
            cell: ({ row }) => (
                <div className="flex justify-center">
                    <Badge
                        variant="outline"
                        className={`max-w-[100px] min-h-[22px] h-auto py-0.5 px-2 text-[10px] justify-center whitespace-normal break-words text-center leading-tight rounded-full ${getUnifiedStatusStyle(row.original.task_status || '...')}`}
                    >
                        {row.original.task_status || '...'}
                    </Badge>
                </div>
            ),
            enableColumnFilter: true,
            filterFn: facetedFilterFn,
            size: 150,
            minSize: 120,
            maxSize: 180,
        },
        {
            id: "file_link",
            accessorKey: "file_link",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Link/Files" />,
            cell: ({ row }) => (
                <FilesCell
                    file_link={row.original.file_link}
                    approval_proof={row.original.approval_proof}
                    task_status={row.original.task_status}
                    size="sm"
                />
            ),
            size: 80,
            minSize: 70,
            maxSize: 100,
            meta: { excludeFromExport: true },
        },
        {
            id: "actions",
            header: ({ column }: { column: any }) => (
                <div className="flex justify-center px-5">
                    <DataTableColumnHeader column={column} title="Edit" />
                </div>
            ),
            cell: ({ row }: { row: any }) => {
                const canEdit = !isRestrictedUser ||
                    (isRestrictedUser && checkIfUserAssigned(row.original));

                return (
                    <div className="flex justify-center">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => canEdit && handleEditClick(row.original)}
                            className={`h-6 px-1.5 ${!canEdit ? 'opacity-50 cursor-not-allowed' : ''}`}
                            disabled={!canEdit}
                        >
                            <Edit className="h-3 w-3" />
                        </Button>
                    </div>
                );
            },
            size: 80,
            minSize: 70,
            maxSize: 100,
            meta: { excludeFromExport: true },
        },
    ];
};
