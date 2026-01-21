// frontend/src/pages/projects/CriticalPOTasks/config/taskTableColumns.tsx

import { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MessageCircle, Edit, ExternalLink } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { CriticalPOTask } from "@/types/NirmaanStack/CriticalPOTasks";
import { Link } from "react-router-dom";
import {
    getCriticalPOStatusStyle,
    formatDeadlineShort,
    parseAssociatedPOs,
    extractPOId,
} from "../utils";

// Encode PO name for URL (replace / with &=)
const encodePOName = (poName: string): string => {
    return poName.replace(/\//g, "&=");
};

// Column IDs that support date filtering
export const TASK_DATE_COLUMNS = ["po_release_date", "revised_date"];

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
        case "today":
            return { start: today, end: endOfDay };
        case "yesterday": {
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            const endYesterday = new Date(yesterday);
            endYesterday.setHours(23, 59, 59, 999);
            return { start: yesterday, end: endYesterday };
        }
        case "this week": {
            const startOfWeek = new Date(today);
            startOfWeek.setDate(today.getDate() - today.getDay());
            return { start: startOfWeek, end: endOfDay };
        }
        case "last week": {
            const startOfLastWeek = new Date(today);
            startOfLastWeek.setDate(today.getDate() - today.getDay() - 7);
            const endOfLastWeek = new Date(startOfLastWeek);
            endOfLastWeek.setDate(startOfLastWeek.getDate() + 6);
            endOfLastWeek.setHours(23, 59, 59, 999);
            return { start: startOfLastWeek, end: endOfLastWeek };
        }
        case "this month": {
            const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
            return { start: startOfMonth, end: endOfDay };
        }
        case "last month": {
            const startOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
            const endOfLastMonth = new Date(today.getFullYear(), today.getMonth(), 0);
            endOfLastMonth.setHours(23, 59, 59, 999);
            return { start: startOfLastMonth, end: endOfLastMonth };
        }
        case "last 7 days": {
            const sevenDaysAgo = new Date(today);
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
            return { start: sevenDaysAgo, end: endOfDay };
        }
        case "last 30 days": {
            const thirtyDaysAgo = new Date(today);
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            return { start: thirtyDaysAgo, end: endOfDay };
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

    const cellDate = new Date(cellValue + "T00:00:00");
    if (isNaN(cellDate.getTime())) return false;

    const { operator, value } = filterValue;

    switch (operator) {
        case "Is": {
            const filterDate = new Date((value as string) + "T00:00:00");
            return cellDate.toDateString() === filterDate.toDateString();
        }
        case "Between": {
            if (!Array.isArray(value) || value.length !== 2) return true;
            const startDate = new Date(value[0] + "T00:00:00");
            const endDate = new Date(value[1] + "T23:59:59");
            return cellDate >= startDate && cellDate <= endDate;
        }
        case "<=": {
            const filterDate = new Date((value as string) + "T23:59:59");
            return cellDate <= filterDate;
        }
        case ">=": {
            const filterDate = new Date((value as string) + "T00:00:00");
            return cellDate >= filterDate;
        }
        case "Timespan": {
            const range = getTimespanDateRange(value as string);
            return cellDate >= range.start && cellDate <= range.end;
        }
        default:
            return true;
    }
};

// Column definitions factory
export const getTaskTableColumns = (
    handleEditClick: (task: CriticalPOTask) => void,
    canEdit: boolean
): ColumnDef<CriticalPOTask>[] => {
    return [
        // Category column (FIRST - as per requirement)
        {
            accessorKey: "critical_po_category",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Category" />,
            cell: ({ row }) => (
                <Badge variant="outline" className="text-xs truncate max-w-[100px]">
                    {row.original.critical_po_category}
                </Badge>
            ),
            enableColumnFilter: true,
            filterFn: facetedFilterFn,
            size: 120,
            minSize: 100,
            maxSize: 150,
        },
        // Item Name column (SECOND)
        {
            accessorKey: "item_name",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Item Name" />,
            cell: ({ row }) => (
                <span className="font-medium text-gray-900 text-xs truncate block max-w-[160px]">
                    {row.original.item_name}
                </span>
            ),
            size: 170,
            minSize: 140,
            maxSize: 200,
        },
        // Sub Category column
        {
            accessorKey: "sub_category",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Sub Category" />,
            cell: ({ row }) => (
                <span className="text-xs text-gray-500 truncate block max-w-[100px]">
                    {row.original.sub_category || "--"}
                </span>
            ),
            size: 110,
            minSize: 90,
            maxSize: 130,
        },
        // PO Release Deadline column
        {
            id: "po_release_date",
            accessorKey: "po_release_date",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Deadline" />,
            cell: ({ row }) => (
                <span className={`text-xs ${row.original.po_release_date ? "" : "text-gray-400"}`}>
                    {row.original.po_release_date ? formatDeadlineShort(row.original.po_release_date) : "--"}
                </span>
            ),
            enableColumnFilter: true,
            filterFn: dateFilterFn,
            size: 100,
            minSize: 85,
            maxSize: 120,
        },
        // Revised Deadline column
        {
            id: "revised_date",
            accessorKey: "revised_date",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Revised" />,
            cell: ({ row }) => (
                <span className={`text-xs ${row.original.revised_date ? "text-amber-600 font-medium" : "text-gray-400"}`}>
                    {row.original.revised_date ? formatDeadlineShort(row.original.revised_date) : "--"}
                </span>
            ),
            enableColumnFilter: true,
            filterFn: dateFilterFn,
            size: 100,
            minSize: 85,
            maxSize: 120,
        },
        // Status column
        {
            accessorKey: "status",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
            cell: ({ row }) => (
                <div className="flex justify-center">
                    <Badge
                        variant="outline"
                        className={`max-w-[100px] min-h-[22px] h-auto py-0.5 px-1.5 text-[10px] justify-center whitespace-normal break-words text-center leading-tight rounded-full ${getCriticalPOStatusStyle(row.original.status)}`}
                    >
                        {row.original.status}
                    </Badge>
                </div>
            ),
            enableColumnFilter: true,
            filterFn: facetedFilterFn,
            size: 110,
            minSize: 90,
            maxSize: 130,
        },
        // Remarks column
        {
            id: "remarks",
            accessorKey: "remarks",
            header: () => <div className="text-center text-[10px]">Notes</div>,
            cell: ({ row }) => (
                <div className="flex justify-center">
                    <TooltipProvider>
                        <Tooltip delayDuration={300}>
                            <TooltipTrigger asChild>
                                <MessageCircle
                                    className={`h-4 w-4 p-0.5 bg-gray-100 rounded ${
                                        row.original.remarks
                                            ? "cursor-pointer text-gray-600 hover:scale-110 transition-transform"
                                            : "text-gray-300"
                                    }`}
                                />
                            </TooltipTrigger>
                            {row.original.remarks && (
                                <TooltipContent className="max-w-xs p-2 bg-white text-gray-900 border shadow-lg">
                                    <p className="text-xs">{row.original.remarks}</p>
                                </TooltipContent>
                            )}
                        </Tooltip>
                    </TooltipProvider>
                </div>
            ),
            size: 50,
            minSize: 40,
            maxSize: 60,
            meta: { excludeFromExport: true },
        },
        // Associated POs column
        {
            id: "associated_pos",
            accessorKey: "associated_pos",
            header: () => <div className="text-center text-[10px]">Linked POs</div>,
            cell: ({ row }) => {
                const linkedPOs = parseAssociatedPOs(row.original.associated_pos);
                const count = linkedPOs.length;
                const projectId = row.original.project;
                const itemName = row.original.item_name;

                if (count === 0) {
                    return <span className="text-xs text-gray-400">--</span>;
                }

                return (
                    <Dialog>
                        <DialogTrigger asChild>
                            <Button
                                variant="secondary"
                                size="sm"
                                className="h-6 text-[10px] px-2 py-0.5 hover:bg-blue-100 transition-colors"
                            >
                                {count} PO{count > 1 ? "s" : ""}
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-md">
                            <DialogHeader>
                                <DialogTitle className="text-base">
                                    Linked Purchase Orders
                                </DialogTitle>
                                <p className="text-sm text-muted-foreground">
                                    {itemName}
                                </p>
                            </DialogHeader>
                            <div className="space-y-2 mt-4 max-h-[300px] overflow-y-auto">
                                {linkedPOs.map((po) => (
                                    <Link
                                        key={po}
                                        to={`/projects/${projectId}/po/${encodePOName(po)}`}
                                        className="flex items-center gap-3 text-sm text-blue-600 hover:text-blue-800 py-2 px-3 rounded-md hover:bg-blue-50 border border-gray-100 transition-colors"
                                    >
                                        <ExternalLink className="h-4 w-4 flex-shrink-0" />
                                        <span className="font-medium">{extractPOId(po)}</span>
                                    </Link>
                                ))}
                            </div>
                        </DialogContent>
                    </Dialog>
                );
            },
            size: 80,
            minSize: 60,
            maxSize: 100,
            meta: { excludeFromExport: true },
        },
        // Actions column (conditionally rendered based on canEdit)
        ...(canEdit
            ? [
                  {
                      id: "actions",
                      header: () => <div className="text-center text-[10px]">Edit</div>,
                      cell: ({ row }: { row: any }) => (
                          <div className="flex justify-center">
                              <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleEditClick(row.original)}
                                  className="h-6 px-1.5"
                              >
                                  <Edit className="h-3 w-3" />
                              </Button>
                          </div>
                      ),
                      size: 50,
                      minSize: 40,
                      maxSize: 60,
                      meta: { excludeFromExport: true },
                  } as ColumnDef<CriticalPOTask>,
              ]
            : []),
    ];
};
