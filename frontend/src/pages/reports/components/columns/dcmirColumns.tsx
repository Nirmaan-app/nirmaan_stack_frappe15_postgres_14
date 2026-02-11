import { ColumnDef } from "@tanstack/react-table";
import { DCMIRReportRowData } from "../../hooks/useDCMIRReportsData";
import { formatDate } from "@/utils/FormatDate";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { dateFilterFn, facetedFilterFn } from "@/utils/tableFilters";
import { Badge } from "@/components/ui/badge";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { DCMIRReportType } from "../../store/useReportStore";
import { Paperclip } from "lucide-react";

// --- Items popover column cell ---
const ItemsSummaryCell = ({ row }: { row: { original: DCMIRReportRowData } }) => {
    const items = row.original.items;
    const summary = row.original.itemsSummary;

    if (!items || items.length === 0) {
        return <span className="text-gray-400 text-xs">No items</span>;
    }

    return (
        <HoverCard>
            <HoverCardTrigger asChild>
                <span className="text-xs cursor-pointer underline decoration-dashed underline-offset-2 line-clamp-2">
                    {summary}
                </span>
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
                            <span className="text-gray-500 whitespace-nowrap ml-2">
                                {item.unit} &times; {item.quantity}
                            </span>
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
    cell: ({ row }) => <div className="text-xs">{row.original.procurement_order}</div>,
    meta: {
        exportHeaderName: "PO No.",
        exportValue: (row: DCMIRReportRowData) => row.procurement_order,
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
        dateColumn,
        itemsColumn,
        signedColumn,
        attachmentColumn,
        stubColumn,
    ];
};
