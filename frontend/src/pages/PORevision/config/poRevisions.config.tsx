import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { formatDate } from "@/utils/FormatDate";
import formatCurrency from "@/utils/FormatPrice";
import { dateFilterFn, facetedFilterFn } from "@/utils/tableFilters";

export const DOCTYPE = "PO Revisions";

export const PO_REVISION_FIELDS_TO_FETCH = [
    "name",
    "revised_po",
    "creation",
    "project",
    "vendor",
    "total_amount_difference",
    "status",
];

export const PO_REVISION_SEARCHABLE_FIELDS = [
    { label: "Revision ID", value: "name" },
    { label: "PO ID", value: "revised_po" }
];

export const PO_REVISION_DATE_COLUMNS = [
    "creation"
];

interface GetPORevisionColumnsArgs {
    getProjectName?: (id?: string) => string;
    getVendorName?: (id?: string) => string;
}

export const getPORevisionColumns = ({
    getProjectName,
    getVendorName
}: GetPORevisionColumnsArgs = {}): ColumnDef<any>[] => [
    {
        accessorKey: "name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Revision ID" />,
        cell: ({ row }) => (
            <Link to={`/po-revisions-approval/${row.original.name}`} className="text-blue-600 hover:underline">
                {row.original.name}
            </Link>
        ),
        meta: { exportHeaderName: "Revision ID", exportValue: (row: any) => row.name }
    },
    {
        accessorKey: "revised_po",
        header: ({ column }) => <DataTableColumnHeader column={column} title="PO ID" />,
        cell: ({ row }) => (
            <Link to={`/purchase-orders/${row.original.revised_po?.replaceAll("/", "&=")}`} className="text-blue-600 hover:underline">
                {row.original.revised_po}
            </Link>
        ),
        meta: { exportHeaderName: "PO ID", exportValue: (row: any) => row.revised_po }
    },
    {
        accessorKey: "creation",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Requested On" />,
        cell: ({ row }) => (
            <div className="text-slate-600">
                {row.original.creation ? formatDate(row.original.creation) : "N/A"}
            </div>
        ),
        filterFn: dateFilterFn,
        meta: { exportHeaderName: "Requested On", exportValue: (row: any) => row.original.creation ? formatDate(row.original.creation) : "N/A" }
    },
    {
        accessorKey: "project",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
        cell: ({ row }) => (
            <div className="text-slate-800">
                {getProjectName ? getProjectName(row.original.project) : (row.original.project || "N/A")}
            </div>
        ),
        filterFn: facetedFilterFn,
        meta: { exportHeaderName: "Project", exportValue: (row: any) => getProjectName ? getProjectName(row.project) : row.project }
    },
    {
        accessorKey: "vendor",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Vendor" />,
        cell: ({ row }) => (
            <div className="text-slate-800">
                {getVendorName ? getVendorName(row.original.vendor) : (row.original.vendor || "N/A")}
            </div>
        ),
        filterFn: facetedFilterFn,
        meta: { exportHeaderName: "Vendor", exportValue: (row: any) => getVendorName ? getVendorName(row.vendor) : row.vendor }
    },
    {
        accessorKey: "total_amount_difference",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Net Difference" />,
        cell: ({ row }) => (
            <div className={`text-right tracking-tight tabular-nums font-medium ${row.original.total_amount_difference < 0 ? 'text-red-600' : 'text-slate-800'}`}>
                {row.original.total_amount_difference ? formatCurrency(row.original.total_amount_difference) : "₹ 0.00"}
            </div>
        ),
        meta: { exportHeaderName: "Net Difference", exportValue: (row: any) => row.original.total_amount_difference || 0, isNumeric: true }
    }
];
