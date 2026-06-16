// frontend/src/pages/CommissionReport/config/taskTableColumns.tsx

import { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { type MasterTaskInfo } from "../components/FillReportButton";
import { ReportActionCell } from "../components/ReportActionCell";
import { CommissionReportTask } from "../types";
import {
    formatDeadlineShort,
    getUnifiedStatusStyle,
} from "../utils";

// Column IDs that support date filtering
export const TASK_DATE_COLUMNS = ["deadline"];

// Custom filter function for faceted (multi-select) filters
const facetedFilterFn = (row: any, columnId: string, filterValue: string[]) => {
    if (!filterValue || filterValue.length === 0) return true;
    const cellValue = row.getValue(columnId);
    return filterValue.includes(cellValue);
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
    checkIfUserAssigned: (task: CommissionReportTask) => boolean,
    /** Required for the "Report" column. Pass empty Map() to hide it. */
    masterMap: Map<string, MasterTaskInfo> = new Map(),
    /** Required for the "Report" column. */
    parentName: string = '',
    /** Refresh the tracker doc after a Report-column status/file mutation. */
    refresh?: () => void,
): ColumnDef<CommissionReportTask>[] => {
    return [
        {
            accessorKey: "commission_category",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Category" />,
            cell: ({ row }) => (
                <span className="text-xs block whitespace-normal break-words leading-tight">{row.original.commission_category || '--'}</span>
            ),
            enableColumnFilter: true,
            filterFn: facetedFilterFn,
            size: 160,
            minSize: 120,
            maxSize: 220,
            meta: { exportHeaderName: "Category" },
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
            meta: { exportHeaderName: "Report Name" },
        },
        {
            id: "report_type",
            accessorFn: (row) => row.report_type || 'Field',
            header: ({ column }) => (
                <div className="flex justify-center">
                    <DataTableColumnHeader column={column} title="Report Type" />
                </div>
            ),
            cell: ({ row }) => {
                const rt = row.original.report_type || 'Field';
                return (
                    <div className="flex justify-center">
                        <span className={`py-0.5 px-2 text-[10px] rounded-full border ${rt === 'Vendor'
                            ? 'bg-orange-50 text-orange-700 border-orange-200'
                            : 'bg-sky-50 text-sky-700 border-sky-200'}`}>
                            {rt}
                        </span>
                    </div>
                );
            },
            enableColumnFilter: true,
            filterFn: facetedFilterFn,
            size: 90,
            minSize: 74,
            maxSize: 110,
            meta: {
                exportHeaderName: "Report Type",
                exportValue: (row: CommissionReportTask) => row.report_type || 'Field',
            },
        },
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
            meta: {
                exportHeaderName: "Deadline",
                exportValue: (row: CommissionReportTask) => row.deadline ? formatDeadlineShort(row.deadline) : '',
            },
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
                        className={`max-w-[110px] min-h-[22px] h-auto py-0.5 px-2 text-[10px] justify-center whitespace-normal break-words text-center leading-tight rounded-full ${getUnifiedStatusStyle(row.original.task_status || '...')}`}
                    >
                        {row.original.task_status || '...'}
                    </Badge>
                </div>
            ),
            enableColumnFilter: true,
            filterFn: facetedFilterFn,
            size: 120,
            minSize: 100,
            maxSize: 140,
            meta: { exportHeaderName: "Status" },
        },
        {
            id: "action",
            header: ({ column }: { column: any }) => (
                <div className="flex justify-center w-full px-2">
                    <DataTableColumnHeader column={column} title="Actions / Reports" />
                </div>
            ),
            cell: ({ row }: { row: any }) => {
                const canEdit = !isRestrictedUser ||
                    (isRestrictedUser && checkIfUserAssigned(row.original));
                return (
                    <ReportActionCell
                        parentName={parentName}
                        task={row.original}
                        masterMap={masterMap}
                        canEdit={canEdit}
                        refresh={refresh}
                        onConfigure={handleEditClick}
                    />
                );
            },
            size: 200,
            minSize: 170,
            maxSize: 240,
            meta: { excludeFromExport: true },
        },
    ];
};
