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


// Type for the function that will provide the project name from the ID
type GetNameFn = (id?: string) => string;

export const getOutflowReportColumns = (getProjectName: GetNameFn, getVendorName: GetNameFn): ColumnDef<OutflowRowData>[] => [
    {
        accessorKey: "payment_date",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Payment Date" />,
        cell: ({ row }) => <div className="font-medium whitespace-nowrap">{formatDate(row.original.payment_date)}</div>,
         filterFn: dateFilterFn,
        // meta: {
        //     exportValue: (row) => formatDate(row.original.payment_date),
        //     exportHeaderName: "Payment Date"
        // },
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
        // meta: {
        //     exportValue: (row) => getProjectName(row.original.project),
        //     exportHeaderName: "Project"
        // },
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
        // meta: {
        //     exportValue: (row) => getVendorName(row.original.vendor),
        //     exportHeaderName: "Vendor"
        // },
    },
    {
        accessorKey: "amount",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Amount Paid" className="text-right" />,
        cell: ({ row }) => <div className="font-medium text-right text-red-600 pr-2">{formatToRoundedIndianRupee(row.original.amount)}</div>,
        // meta: {
        //     exportValue: (row) => formatForReport(row.original.amount),
        //     exportHeaderName: "Amount Paid"
        // },
    },
    {
        accessorKey: "expense_type",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Expense Type" />,
        cell: ({ row }) => <div className="truncate" title={row.original.expense_type}>{row.original.expense_type}</div>,
        filterFn: facetedFilterFn,
        // meta: {
        //     exportValue: (row) => row.original.expense_type,
        //     exportHeaderName: "Expense Type"
        // },
    },
    {
        accessorKey: "details",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Details" />,
        cell: ({ row }) => <div className="truncate max-w-xs" title={row.original.details}>{row.original.details}</div>,
        // meta: {
        //     exportValue: (row) => row.original.details,
        //     exportHeaderName: "Details"
        // },
    },
    {
        accessorKey: "ref",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Ref (UTR/Comment)" />,
        cell: ({ row }) => <div className="truncate max-w-xs" title={row.original.ref}>{row.original.ref}</div>,
        // meta: {
        //     exportValue: (row) => row.original.ref,
        //     exportHeaderName: "Ref"
        // },
    },
];