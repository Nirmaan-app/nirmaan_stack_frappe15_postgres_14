import { ColumnDef } from "@tanstack/react-table";
import { SRReportRowData } from "../../hooks/useSRReportsData";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { formatDate } from "@/utils/FormatDate";
import { Info } from "lucide-react";
import { Link } from "react-router-dom";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { dateFilterFn, facetedFilterFn } from "@/utils/tableFilters"; // Assuming you have this utility file

export const srColumns: ColumnDef<SRReportRowData>[] = [
    {
        accessorKey: "name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="#SR" />,
        cell: ({ row }) => {
            const name = row.original.name;
            return (
                <div className="flex items-center">
                    {name}
                    <Link to={`/service-requests/${name.replaceAll("/", "&=")}?tab=approved-sr`}>
                        <Info className="text-blue-500 h-3 w-3 ml-1 mt-0.5" />
                    </Link>
                </div>
            );
        },
        size: 200, // Adjust size as needed
        meta: { exportHeaderName: "#SR", exportValue: (row: SRReportRowData) => row.name }
    },
    {
        accessorKey: "creation",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Date Created" />,
        cell: ({ row }) => <div>{formatDate(row.original.creation)}</div>,
        filterFn: dateFilterFn, // <--- ADD THIS
        meta: {
            exportValue: (row: SRReportRowData) => formatDate(row.creation),
            exportHeaderName: "Date Created"
        }
    },
    {
        id: "project", // Using id for faceted filter key
        accessorFn: row => row.projectName || row.project,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
        cell: ({ row }) => <div>{row.original.projectName || row.original.project}</div>,
        filterFn: facetedFilterFn, // <--- ADD THIS
        meta: {
            exportHeaderName: "Project",
            exportValue: (row: SRReportRowData) => row.projectName || row.project
        }
    },
    {
        id: "vendor_name", // Using id for faceted filter key
        accessorFn: row => row.vendorName || row.vendor,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Vendor" />,
        cell: ({ row }) => <div>{row.original.vendorName || row.original.vendor}</div>,
        filterFn: facetedFilterFn, // <--- ADD THIS
        meta: {
            exportHeaderName: "Vendor",
            exportValue: (row: SRReportRowData) => row.vendorName || row.vendor
        }
    },
    {
        accessorKey: "totalAmount",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Total SR Amt" />, // Corrected title
        cell: ({ row }) => <div className="tabular-nums">{formatToRoundedIndianRupee(row.original.totalAmount)}</div>,
        meta: {
            exportValue: (row: SRReportRowData) => formatToRoundedIndianRupee(row.totalAmount),
            exportHeaderName: "Total SR Amt", isNumeric: true // Corrected title
        }
    },
    {
        accessorKey: "invoiceAmount",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Total Invoice Amt" />,
        cell: ({ row }) => <div className="tabular-nums">{formatToRoundedIndianRupee(row.original.invoiceAmount)}</div>,
        meta: {
            exportValue: (row: SRReportRowData) => formatToRoundedIndianRupee(row.invoiceAmount),
            exportHeaderName: "Total Invoice Amt", isNumeric: true
        }
    },
    {
        accessorKey: "amountPaid",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Amt Paid" />,
        cell: ({ row }) => <div className="tabular-nums">{formatToRoundedIndianRupee(row.original.amountPaid)}</div>,
        meta: {
            exportValue: (row: SRReportRowData) => formatToRoundedIndianRupee(row.amountPaid),
            exportHeaderName: "Amt Paid", isNumeric: true
        }
    },
];