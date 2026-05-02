import { ColumnDef } from "@tanstack/react-table";
import { DCMIRReportRowData } from "../../hooks/useDCMIRReportsData";
import { formatDate } from "@/utils/FormatDate";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { dateFilterFn, facetedFilterFn } from "@/utils/tableFilters";
import { Badge } from "@/components/ui/badge";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { DCMIRReportType } from "../../store/useReportStore";
import { Link } from "react-router-dom";
import { Paperclip } from "lucide-react";
import { CriticalPOCell, criticalPOLabel } from "@/components/helpers/CriticalPOCell";

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

// PO No. column — only included for parent_doctype="Procurement Orders" rows.
// Reads `parent_docname` (the polymorphic field) with a fallback to the deprecated
// `procurement_order` field for any pre-backfill row that slips through.
const poColumn: ColumnDef<DCMIRReportRowData> = {
    id: "po_no",
    accessorFn: (row) => row.parent_docname || row.procurement_order || "",
    header: ({ column }) => <DataTableColumnHeader column={column} title="PO No." />,
    cell: ({ row }) => {
        const po = row.original.parent_docname || row.original.procurement_order;
        if (!po) return <span className="text-gray-400 text-xs">—</span>;
        return (
            <Link
                to={`/project-payments/${po.split("/").join("&=")}`}
                className="text-xs text-blue-600 hover:text-blue-800 hover:underline font-medium"
            >
                {po}
            </Link>
        );
    },
    meta: {
        exportHeaderName: "PO No.",
        exportValue: (row: DCMIRReportRowData) => row.parent_docname || row.procurement_order || "",
    },
};

const criticalPOColumn: ColumnDef<DCMIRReportRowData> = {
    id: "critical_po",
    accessorFn: (row) => row.criticalPOTasks?.map(criticalPOLabel).join(", ") || "",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Critical PO" />,
    cell: ({ row }) => <CriticalPOCell tasks={row.original.criticalPOTasks} />,
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

// --- Source Project column: shown for ITM rows (replaces vendorColumn) ---
const sourceProjectColumn: ColumnDef<DCMIRReportRowData> = {
    id: "source_project_name",
    accessorFn: (row) => row.sourceProjectName || row.source_project || "",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Source Project" />,
    cell: ({ row }) => <div>{row.original.sourceProjectName || row.original.source_project || "—"}</div>,
    meta: {
        exportHeaderName: "Source Project",
        exportValue: (row: DCMIRReportRowData) => row.sourceProjectName || row.source_project || "",
    },
    filterFn: facetedFilterFn,
};

// --- ITM-specific column: replaces poColumn when parent is an ITM ---
const itmColumn: ColumnDef<DCMIRReportRowData> = {
    id: "itm_no",
    accessorFn: (row) => row.parent_docname || "",
    header: ({ column }) => <DataTableColumnHeader column={column} title="ITM No." />,
    cell: ({ row }) => {
        const itmName = row.original.parent_docname;
        if (!itmName) return <span className="text-gray-400 text-xs">—</span>;
        return (
            <Link
                to={`/internal-transfer-memos/${itmName}`}
                className="text-xs text-blue-600 hover:text-blue-800 hover:underline font-medium"
            >
                {itmName}
            </Link>
        );
    },
    meta: {
        exportHeaderName: "ITM No.",
        exportValue: (row: DCMIRReportRowData) => row.parent_docname || "",
    },
};

interface DCMIRColumnOptions {
    parentDoctype?: 'Procurement Orders' | 'Internal Transfer Memo';
}

// --- Function to get columns based on report type ---
export const getDCMIRReportColumns = (
    reportType: DCMIRReportType,
    { parentDoctype = 'Procurement Orders' }: DCMIRColumnOptions = {}
): ColumnDef<DCMIRReportRowData>[] => {
    const isITM = parentDoctype === 'Internal Transfer Memo';

    // Project column header label changes for ITM (it's the receiver / target project)
    const projectCol: ColumnDef<DCMIRReportRowData> = isITM
        ? {
            ...projectColumn,
            header: ({ column }) => <DataTableColumnHeader column={column} title="Target Project" />,
            meta: {
                exportHeaderName: "Target Project",
                exportValue: (row: DCMIRReportRowData) => row.projectName || row.project,
            },
        }
        : projectColumn;

    // Parent identity columns: ITM No. + Source Project for ITM; Vendor + PO + Critical for PO.
    const parentCols: ColumnDef<DCMIRReportRowData>[] = isITM
        ? [itmColumn, sourceProjectColumn]
        : [vendorColumn, poColumn, criticalPOColumn];

    if (reportType === 'MIR Report') {
        return [
            projectCol,
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
            ...parentCols,
            dateColumn,
            itemsColumn,
            signedColumn,
            attachmentColumn,
            stubColumn,
        ];
    }

    // DC Report (default)
    return [
        projectCol,
        {
            accessorKey: "reference_number",
            header: ({ column }) => <DataTableColumnHeader column={column} title="DC No." />,
            cell: ({ row }) => <div className="font-medium">{row.original.reference_number || "—"}</div>,
            meta: {
                exportHeaderName: "DC No.",
                exportValue: (row: DCMIRReportRowData) => row.reference_number || "",
            },
        },
        ...parentCols,
        dateColumn,
        itemsColumn,
        signedColumn,
        attachmentColumn,
        stubColumn,
    ];
};
