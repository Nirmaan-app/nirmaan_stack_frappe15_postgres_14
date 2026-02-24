import { ColumnDef } from "@tanstack/react-table";
import { DCMIRReportRowData } from "../../hooks/useDCMIRReportsData";
import { formatDate } from "@/utils/FormatDate";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { dateFilterFn, facetedFilterFn } from "@/utils/tableFilters";
import { Badge } from "@/components/ui/badge";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { DCMIRReportType } from "../../store/useReportStore";
import { Link } from "react-router-dom";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Paperclip, AlertTriangle } from "lucide-react";

// --- Items popover column cell ---
const ItemsSummaryCell = ({ row }: { row: { original: DCMIRReportRowData } }) => {
    const items = row.original.items;

    if (!items || items.length === 0) {
        return <span className="text-gray-400 text-xs">No items</span>;
    }

    const allZeroQty = items.every((item) => !item.quantity);

    return (
        <HoverCard>
            <HoverCardTrigger asChild>
                <ul className="list-disc list-inside space-y-0.5 text-xs cursor-pointer">
                    {items.slice(0, 3).map((item, idx) => (
                        <li key={item.name || idx}>
                            <span className="font-medium text-gray-700">{item.item_name}</span>
                            {!allZeroQty && item.quantity ? (
                                <span className="text-blue-600 ml-1">({item.unit} &times; {item.quantity})</span>
                            ) : null}
                        </li>
                    ))}
                    {items.length > 3 && (
                        <li className="text-gray-400">+{items.length - 3} more...</li>
                    )}
                </ul>
            </HoverCardTrigger>
            <HoverCardContent className="w-80 p-3" align="start">
                <div className="space-y-1.5">
                    <p className="text-xs font-semibold text-gray-700 mb-2">
                        Items ({items.length})
                    </p>
                    {items.map((item, idx) => (
                        <div key={item.name || idx} className="flex justify-between text-xs border-b border-gray-100 pb-1">
                            <span className="text-gray-700 font-medium truncate max-w-[180px]" title={item.item_name}>
                                {item.item_name}
                            </span>
                            {!allZeroQty && item.quantity ? (
                                <span className="text-blue-600 whitespace-nowrap ml-2">
                                    {item.unit} &times; {item.quantity}
                                </span>
                            ) : null}
                        </div>
                    ))}
                </div>
            </HoverCardContent>
        </HoverCard>
    );
};

// --- Shared columns (used by both DC and MIR reports) ---
const projectColumn: ColumnDef<DCMIRReportRowData> = {
    id: "project_name",
    accessorFn: (row) => row.projectName || row.project,
    header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
    cell: ({ row }) => <div>{row.original.projectName || row.original.project}</div>,
    meta: {
        exportHeaderName: "Project",
        exportValue: (row: DCMIRReportRowData) => row.projectName || row.project,
    },
    filterFn: facetedFilterFn,
};

const vendorColumn: ColumnDef<DCMIRReportRowData> = {
    id: "vendor_name",
    accessorFn: (row) => row.vendorName || row.vendor || "",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Vendor" />,
    cell: ({ row }) => <div>{row.original.vendorName || row.original.vendor || "—"}</div>,
    meta: {
        exportHeaderName: "Vendor",
        exportValue: (row: DCMIRReportRowData) => row.vendorName || row.vendor || "",
    },
    filterFn: facetedFilterFn,
};

const poColumn: ColumnDef<DCMIRReportRowData> = {
    accessorKey: "procurement_order",
    header: ({ column }) => <DataTableColumnHeader column={column} title="PO No." />,
    cell: ({ row }) => (
        <Link
            to={`/project-payments/${row.original.procurement_order.split("/").join("&=")}`}
            className="text-xs text-blue-600 hover:text-blue-800 hover:underline font-medium"
        >
            {row.original.procurement_order}
        </Link>
    ),
    meta: {
        exportHeaderName: "PO No.",
        exportValue: (row: DCMIRReportRowData) => row.procurement_order,
    },
};

const CriticalPOCell = ({ row }: { row: { original: DCMIRReportRowData } }) => {
    const tasks = row.original.criticalPOTasks;

    if (!tasks || tasks.length === 0) {
        return <span className="text-gray-300 text-xs">—</span>;
    }

    return (
        <div className="flex flex-col gap-1">
            {tasks.map((task) => (
                <Tooltip key={task.name}>
                    <TooltipTrigger asChild>
                        <span
                            className={`
                                inline-flex items-center gap-1.5
                                px-2 py-0.5 rounded-md text-xs font-medium
                                bg-gradient-to-r from-red-50 to-amber-50
                                border border-red-200/60
                                text-slate-700
                                shadow-sm shadow-red-100/50
                                cursor-default
                            `}
                        >
                            <span className="relative flex h-2 w-2 shrink-0">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                            </span>
                            <span className="truncate max-w-[120px]">
                                {task.item_name}{task.sub_category ? ` (${task.sub_category})` : ""}
                            </span>
                        </span>
                    </TooltipTrigger>
                    <TooltipContent
                        side="bottom"
                        className="bg-slate-900 text-white border-slate-800 shadow-xl"
                    >
                        <div className="space-y-1.5 text-xs py-0.5">
                            <div className="flex items-center gap-1.5 text-red-400 font-semibold">
                                <AlertTriangle className="w-3 h-3" />
                                Critical PO Task
                            </div>
                            <div className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-slate-300">
                                <span className="text-slate-500">Category</span>
                                <span>{task.critical_po_category}</span>
                                {task.sub_category && (
                                    <>
                                        <span className="text-slate-500">Sub-category</span>
                                        <span>{task.sub_category}</span>
                                    </>
                                )}
                                <span className="text-slate-500">Deadline</span>
                                <span className="text-amber-400">{formatDate(task.po_release_date)}</span>
                                <span className="text-slate-500">Status</span>
                                <span>{task.status}</span>
                            </div>
                        </div>
                    </TooltipContent>
                </Tooltip>
            ))}
        </div>
    );
};

/** Build display label for a Critical PO task: "ItemName (SubCategory)" or just "ItemName" */
export const criticalPOLabel = (t: { item_name: string; sub_category?: string }) =>
    t.sub_category ? `${t.item_name} (${t.sub_category})` : t.item_name;

const criticalPOColumn: ColumnDef<DCMIRReportRowData> = {
    id: "critical_po",
    accessorFn: (row) => row.criticalPOTasks?.map(criticalPOLabel).join(", ") || "",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Critical PO" />,
    cell: ({ row }) => <CriticalPOCell row={row} />,
    size: 180,
    enableSorting: false,
    filterFn: (row, _columnId, filterValue: string[]) => {
        if (!filterValue || filterValue.length === 0) return true;
        const tasks = row.original.criticalPOTasks;
        if (!tasks || tasks.length === 0) return false;
        const rowLabels = tasks.map(criticalPOLabel);
        return filterValue.some((v) => rowLabels.includes(v));
    },
    meta: {
        exportHeaderName: "Critical PO Categories",
        exportValue: (row: DCMIRReportRowData) =>
            row.criticalPOTasks?.map(criticalPOLabel).join(", ") || "",
    },
};

const dateColumn: ColumnDef<DCMIRReportRowData> = {
    accessorKey: "dc_date",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
    cell: ({ row }) => (
        <div>{row.original.dc_date ? formatDate(row.original.dc_date) : "—"}</div>
    ),
    meta: {
        exportHeaderName: "Date",
        exportValue: (row: DCMIRReportRowData) => row.dc_date ? formatDate(row.dc_date) : "",
    },
    filterFn: dateFilterFn,
};

const itemsColumn: ColumnDef<DCMIRReportRowData> = {
    id: "itemsSummary",
    accessorFn: (row) => row.itemsSummary,
    header: ({ column }) => <DataTableColumnHeader column={column} title="Items" />,
    cell: ({ row }) => <ItemsSummaryCell row={row} />,
    size: 250,
    meta: {
        exportHeaderName: "Items",
        exportValue: (row: DCMIRReportRowData) => row.itemsSummary,
    },
};

const signedColumn: ColumnDef<DCMIRReportRowData> = {
    id: "is_signed",
    accessorFn: (row) => row.is_signed_by_client === 1 ? "Yes" : "No",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Signed" />,
    cell: ({ row }) => {
        const signed = row.original.is_signed_by_client === 1;
        return (
            <Badge variant={signed ? "default" : "outline"} className={signed ? "bg-green-100 text-green-800 hover:bg-green-100" : "text-gray-500"}>
                {signed ? "Yes" : "No"}
            </Badge>
        );
    },
    meta: {
        exportHeaderName: "Signed by Client",
        exportValue: (row: DCMIRReportRowData) => row.is_signed_by_client === 1 ? "Yes" : "No",
    },
    filterFn: facetedFilterFn,
};

const stubColumn: ColumnDef<DCMIRReportRowData> = {
    id: "is_stub",
    accessorFn: (row) => row.is_stub === 1 ? "Stub" : "Complete",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
    cell: ({ row }) => {
        const isStub = row.original.is_stub === 1;
        return (
            <Badge variant="outline" className={isStub ? "text-amber-600 border-amber-300" : "text-green-700 border-green-300"}>
                {isStub ? "Stub" : "Complete"}
            </Badge>
        );
    },
    meta: {
        exportHeaderName: "Status",
        exportValue: (row: DCMIRReportRowData) => row.is_stub === 1 ? "Stub" : "Complete",
    },
    filterFn: facetedFilterFn,
};

const attachmentColumn: ColumnDef<DCMIRReportRowData> = {
    id: "attachment",
    accessorFn: (row) => row.attachment_url ? "Yes" : "No",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Attachment" />,
    cell: ({ row }) => {
        const url = row.original.attachment_url;
        if (!url) return <span className="text-gray-400 text-xs">—</span>;
        return (
            <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 text-xs"
            >
                <Paperclip className="h-3 w-3" />
                View
            </a>
        );
    },
    size: 90,
    enableSorting: false,
    meta: {
        exportHeaderName: "Attachment",
        exportValue: (row: DCMIRReportRowData) => row.attachment_url || "",
    },
};

// --- Function to get columns based on report type ---
export const getDCMIRReportColumns = (reportType: DCMIRReportType): ColumnDef<DCMIRReportRowData>[] => {
    if (reportType === 'MIR Report') {
        return [
            projectColumn,
            {
                accessorKey: "reference_number",
                header: ({ column }) => <DataTableColumnHeader column={column} title="MIR No." />,
                cell: ({ row }) => <div className="font-medium">{row.original.reference_number || "—"}</div>,
                meta: {
                    exportHeaderName: "MIR No.",
                    exportValue: (row: DCMIRReportRowData) => row.reference_number || "",
                },
            },
            {
                accessorKey: "dc_reference",
                header: ({ column }) => <DataTableColumnHeader column={column} title="DC Ref" />,
                cell: ({ row }) => <div className="text-xs">{row.original.dc_reference || "—"}</div>,
                meta: {
                    exportHeaderName: "DC Reference",
                    exportValue: (row: DCMIRReportRowData) => row.dc_reference || "",
                },
            },
            vendorColumn,
            poColumn,
            criticalPOColumn,
            dateColumn,
            itemsColumn,
            signedColumn,
            attachmentColumn,
            stubColumn,
        ];
    }

    // DC Report (default)
    return [
        projectColumn,
        {
            accessorKey: "reference_number",
            header: ({ column }) => <DataTableColumnHeader column={column} title="DC No." />,
            cell: ({ row }) => <div className="font-medium">{row.original.reference_number || "—"}</div>,
            meta: {
                exportHeaderName: "DC No.",
                exportValue: (row: DCMIRReportRowData) => row.reference_number || "",
            },
        },
        vendorColumn,
        poColumn,
        criticalPOColumn,
        dateColumn,
        itemsColumn,
        signedColumn,
        attachmentColumn,
        stubColumn,
    ];
};
