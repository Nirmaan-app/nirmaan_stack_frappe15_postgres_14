// /workspace/development/frappe-bench/apps/nirmaan_stack/frontend/srcsrc/pages/reports/components/columns/outflowColumns.tsx

import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee, formatForReport } from "@/utils/FormatPrice";
import { OutflowRowData } from "../../hooks/useOutflowReportData";
import { dateFilterFn, facetedFilterFn } from "@/utils/tableFilters";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Download, Info } from "lucide-react";
import { outflowInvoiceCell, outflowInvoiceExportText } from "../../utils/outflowInvoiceCell";


// Type for the function that will provide the project name from the ID
type GetNameFn = (id?: string) => string;

/** The Invoice column (#1603): a Project Expense's invoice link, its No-invoice mark, or a dash; blank on a payment. */
const invoiceColumn = (getUserName: GetNameFn, siteUrl: string): ColumnDef<OutflowRowData> => ({
    id: "invoice",
    header: "Invoice",
    enableSorting: false,
    cell: ({ row }) => {
        const cell = outflowInvoiceCell(row.original, getUserName);
        switch (cell.kind) {
            case "invoice":
                return (
                    <a
                        href={siteUrl + cell.url}
                        target="_blank"
                        rel="noreferrer"
                        title="Open invoice"
                        className="whitespace-nowrap font-medium text-blue-600 underline hover:text-blue-800"
                    >
                        View invoice
                    </a>
                );
            case "no_invoice":
                return (
                    <span className="whitespace-nowrap font-medium text-amber-700" title={cell.detail}>
                        {cell.label}
                    </span>
                );
            case "none":
                return <span className="text-gray-400">—</span>;
            case "blank":
                return null;
        }
    },
    meta: {
        exportValue: (row: OutflowRowData) => outflowInvoiceExportText(row, getUserName, siteUrl),
        exportHeaderName: "Invoice",
    },
});

export const getOutflowReportColumns = (
    getProjectName: GetNameFn,
    getVendorName: GetNameFn,
    getUserName: GetNameFn = (id) => id || "--",
    // The site's origin for the invoice link (`SITEURL`), passed in so this file loads without a browser.
    siteUrl = "",
): ColumnDef<OutflowRowData>[] => [
    {
        accessorKey: "payment_date",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Payment Date" />,
        cell: ({ row }) => <div className="font-medium whitespace-nowrap">{formatDate(row.original.payment_date)}</div>,
        filterFn: dateFilterFn,
        meta: {
            exportValue: (row) => formatDate(row.payment_date),
            exportHeaderName: "Payment Date"
        },
    },
    {
        accessorKey: "project",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
        cell: ({ row }) => (
            // <Link to={`/projects/${row.original.project}`} className="text-blue-600 hover:underline">
            //     {getProjectName(row.original.project)}
            // </Link>
            <div className="font-medium flex items-center gap-1.5 group min-w-[170px]">
                <span className="truncate" title={getProjectName(row.original.project)}>{getProjectName(row.original.project)}</span>
                <HoverCard><HoverCardTrigger asChild><Link to={`/projects/${row.original.project}`}><Info className="w-4 h-4 text-blue-600 opacity-70 group-hover:opacity-100" /></Link></HoverCardTrigger><HoverCardContent className="text-xs w-auto p-1.5">View Project</HoverCardContent></HoverCard>
            </div>
        ),
        filterFn: facetedFilterFn,
        meta: {
            exportValue: (row) => getProjectName(row.project),
            exportHeaderName: "Project"
        },
    },
    {
        accessorKey: "vendor",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Vendor" />,
        cell: ({ row }) => (
            // <div className="truncate" title={getVendorName(row.original.vendor)}>
            //     {getVendorName(row.original.vendor)}
            // </div>
            <div className="font-medium flex items-center gap-1.5 group">
                <span className="truncate" title={getVendorName(row.original.vendor)}>{getVendorName(row.original.vendor)}</span>
                <HoverCard><HoverCardTrigger asChild><Link to={`/vendors/${row.original.vendor}`}><Info className="w-4 h-4 text-blue-600 opacity-70 group-hover:opacity-100" /></Link></HoverCardTrigger><HoverCardContent className="text-xs w-auto p-1.5">View vendor</HoverCardContent></HoverCard>
            </div>
        ),
        filterFn: facetedFilterFn,
        meta: {
            exportValue: (row) => getVendorName(row.vendor),
            exportHeaderName: "Vendor"
        },
    },
    {
        accessorKey: "amount",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Amount Paid" className="text-right" />,
        cell: ({ row }) => <div className="font-medium text-center text-red-600 pr-2">{formatToRoundedIndianRupee(row.original.amount)}</div>,
        meta: {
            exportValue: (row) => formatForReport(row.amount),
            exportHeaderName: "Amount Paid"
        },
    },
    {
        accessorKey: "expense_type",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Expense Type" />,
        cell: ({ row }) => <div className="truncate" title={row.original.expense_type}>{row.original.expense_type}</div>,
        filterFn: facetedFilterFn,
        meta: {
            exportValue: (row) => row.expense_type,
            exportHeaderName: "Expense Type"
        },
    },
    {
        accessorKey: "details",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Details" />,
        cell: ({ row }) => <div className="truncate max-w-xs" title={row.original.details}>{row.original.details}</div>,
        meta: {
            exportValue: (row) => row.details,
            exportHeaderName: "Details"
        },
    },
    {
        accessorKey: "effective_gst",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Effective GST" className="text-right" />,
        cell: ({ row }) => {
            const gst = row.original.effective_gst;
            if (gst > 0) {
                // Display the GST rate with two decimal places
                return <div className="text-center font-medium tabular-nums pr-2">{gst.toFixed(2)}%</div>;
            }
            // Display a dash for rows with no applicable GST
            return <div className="text-center text-gray-400">--</div>;
        },
        enableSorting: true,
        meta: {
            exportValue: (row) => (row.effective_gst > 0 ? row.effective_gst.toFixed(2) : 'N/A'),
            exportHeaderName: "Effective GST (%)"
        },
    },
    {
        accessorKey: "ref",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Ref (UTR/Comment)" />,
        cell: ({ row }) => <div className="truncate max-w-xs" title={row.original.ref}>{row.original.ref}</div>,
        meta: {
            exportValue: (row) => row.ref,
            exportHeaderName: "Ref"
        },
    },
    invoiceColumn(getUserName, siteUrl),
];
