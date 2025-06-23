import { ColumnDef } from "@tanstack/react-table";
import { POReportRowData } from "../../hooks/usePOReportsData";
import { formatForReport, formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { formatDate } from "@/utils/FormatDate";
import { Info } from "lucide-react";
import { Link } from "react-router-dom";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { ReportType } from "../../store/useReportStore";
import { dateFilterFn, facetedFilterFn } from "@/utils/tableFilters";

// Base columns, always present for PO reports
export const basePOColumns: ColumnDef<POReportRowData>[] = [
    {
        accessorKey: "name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="#PO" />,
        cell: ({ row }) => {
            const name = row.original.name;
            return <div className="flex items-center">{name}
                <Link to={`/project-payments/${name.replaceAll("/", "&=")}`}>
                    <Info className="text-blue-500 h-3 w-3 ml-1 mt-0.5" />
                </Link>
            </div>;
        },
        size: 200,
        meta: { exportHeaderName: "#PO", exportValue: (row: POReportRowData) => row.name }
    },
    {
        accessorKey: "creation",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Date Created" />,
        cell: ({ row }) => <div>{formatDate(row.original.creation)}</div>,
        meta: {
            exportValue: (row: POReportRowData) => formatDate(row.creation),
            exportHeaderName: "Date Created"
        },
        filterFn: dateFilterFn
    },
    {
        id: "project", // Using id for faceted filter key
        accessorFn: row => row.projectName || row.project, // For sorting/filtering if values are just IDs
        header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
        cell: ({ row }) => <div>{row.original.projectName || row.original.project}</div>, // Display name
        meta: {
            exportHeaderName: "Project",
            exportValue: (row: POReportRowData) => row.projectName || row.project
        },
        filterFn: facetedFilterFn,
    },
    {
        id: "vendor_name", // Using id for faceted filter key
        accessorFn: row => row.vendorName || row.vendor, // For sorting/filtering if values are just IDs
        header: ({ column }) => <DataTableColumnHeader column={column} title="Vendor" />,
        cell: ({ row }) => <div>{row.original.vendorName || row.original.vendor}</div>, // Display name
        meta: {
            exportHeaderName: "Vendor",
            exportValue: (row: POReportRowData) => row.vendorName || row.vendor
        },
        filterFn: facetedFilterFn
    },
    {
        accessorKey: "totalAmount", // This is pre-calculated in POReportRowData
        header: ({ column }) => <DataTableColumnHeader column={column} title="Total PO Amt" />,
        cell: ({ row }) => <div className="tabular-nums">{formatToRoundedIndianRupee(row.original.totalAmount)}</div>,
        meta: {
            exportValue: (row: POReportRowData) => formatForReport(row.totalAmount),
            exportHeaderName: "Total PO Amt", isNumeric: true
        }
    },
    {
        accessorKey: "invoiceAmount", // This is pre-calculated in POReportRowData
        header: ({ column }) => <DataTableColumnHeader column={column} title="Total Invoice Amt" />,
        cell: ({ row }) => <div className="tabular-nums">{formatToRoundedIndianRupee(row.original.invoiceAmount)}</div>,
        meta: {
            exportValue: (row: POReportRowData) => formatForReport(row.invoiceAmount),
            exportHeaderName: "Total Invoice Amt", isNumeric: true
        }
    },
    {
        accessorKey: "amountPaid", // This is pre-calculated in POReportRowData
        header: ({ column }) => <DataTableColumnHeader column={column} title="Amt Paid" />,
        cell: ({ row }) => <div className="tabular-nums">{formatToRoundedIndianRupee(row.original.amountPaid)}</div>,
        meta: {
            exportValue: (row: POReportRowData) => formatForReport(row.amountPaid),
            exportHeaderName: "Amt Paid", isNumeric: true
        }
    },
];

export const basePOColumnsForPM: ColumnDef<POReportRowData>[] = [
    {
        accessorKey: "name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="#PO" />,
        cell: ({ row }) => {
            const name = row.original.name;
            return <div className="flex items-center">{name}
                <Link to={`/prs&milestones/delivery-notes/${name.replaceAll("/", "&=")}`}>
                    <Info className="text-blue-500 h-3 w-3 ml-1 mt-0.5" />
                </Link>
            </div>;
        },
        size: 200,
        meta: { exportHeaderName: "#PO", exportValue: (row: POReportRowData) => row.name }
    },
    {
        accessorKey: "creation",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Date Created" />,
        cell: ({ row }) => <div>{formatDate(row.original.creation)}</div>,
        meta: {
            exportValue: (row: POReportRowData) => formatDate(row.creation),
            exportHeaderName: "Date Created"
        },
        filterFn: dateFilterFn
    },
    {
        id: "project", // Using id for faceted filter key
        accessorFn: row => row.projectName || row.project, // For sorting/filtering if values are just IDs
        header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
        cell: ({ row }) => <div>{row.original.projectName || row.original.project}</div>, // Display name
        meta: {
            exportHeaderName: "Project",
            exportValue: (row: POReportRowData) => row.projectName || row.project
        },
        filterFn: facetedFilterFn,
    },
    {
        id: "vendor_name", // Using id for faceted filter key
        accessorFn: row => row.vendorName || row.vendor, // For sorting/filtering if values are just IDs
        header: ({ column }) => <DataTableColumnHeader column={column} title="Vendor" />,
        cell: ({ row }) => <div>{row.original.vendorName || row.original.vendor}</div>, // Display name
        meta: {
            exportHeaderName: "Vendor",
            exportValue: (row: POReportRowData) => row.vendorName || row.vendor
        },
        filterFn: facetedFilterFn
    },
    {
        accessorKey: "totalAmount", // This is pre-calculated in POReportRowData
        header: ({ column }) => <DataTableColumnHeader column={column} title="Total PO Amt" />,
        cell: ({ row }) => <div className="tabular-nums">{formatToRoundedIndianRupee(row.original.totalAmount)}</div>,
        meta: {
            exportValue: (row: POReportRowData) => formatForReport(row.totalAmount),
            exportHeaderName: "Total PO Amt", isNumeric: true
        }
    },
    {
        accessorKey: "invoiceAmount", // This is pre-calculated in POReportRowData
        header: ({ column }) => <DataTableColumnHeader column={column} title="Total Invoice Amt" />,
        cell: ({ row }) => <div className="tabular-nums">{formatToRoundedIndianRupee(row.original.invoiceAmount)}</div>,
        meta: {
            exportValue: (row: POReportRowData) => formatForReport(row.invoiceAmount),
            exportHeaderName: "Total Invoice Amt", isNumeric: true
        }
    },
    {
        accessorKey: "amountPaid", // This is pre-calculated in POReportRowData
        header: ({ column }) => <DataTableColumnHeader column={column} title="Amt Paid" />,
        cell: ({ row }) => <div className="tabular-nums">{formatToRoundedIndianRupee(row.original.amountPaid)}</div>,
        meta: {
            exportValue: (row: POReportRowData) => formatForReport(row.amountPaid),
            exportHeaderName: "Amt Paid", isNumeric: true
        }
    },
];

// // Column specific to "Dispatched for 3 days" report
// export const dispatchedDateColumn: ColumnDef<POReportRowData> = {
//     // POReportRowData contains originalDoc. We access dispatch_date through it.
//     // For direct access for sorting/filtering by TanStack table, if `originalDoc.dispatch_date` is complex,
//     // you might need an accessorFn. If it's a direct string/date on `originalDoc`, this is fine.
//     accessorKey: "dispatch_date",
//     header: ({ column }) => <DataTableColumnHeader column={column} title="Dispatched Date" />,
//     cell: ({ row }) => {
//         const poDoc = row.original.originalDoc as ProcurementOrder; // POReportRowData.originalDoc is already ProcurementOrder
//         return <div>{poDoc.dispatch_date ? formatDate(poDoc.dispatch_date) : "N/A"}</div>;
//     },
//     meta: {
//         exportValue: (row: POReportRowData) => {
//             const poDoc = row.originalDoc as ProcurementOrder;
//             return poDoc.dispatch_date ? formatDate(poDoc.dispatch_date) : "N/A";
//         },
//         exportHeaderName: "Dispatched Date"
//     },
//     filterFn: dateFilterFn,
// };
// Column specific to "Dispatched for 3 days" report

export const dispatchedDateColumn: ColumnDef<POReportRowData> = {
    // UPDATED: Replaced accessorKey with id and accessorFn
    id: "dispatch_date", // A unique string ID for the column
    accessorFn: (row) => row.originalDoc.dispatch_date, // Explicitly tell the table where to get the data

    header: ({ column }) => <DataTableColumnHeader column={column} title="Dispatched Date" />,
    cell: ({ row }) => {
        // We can now use row.getValue() which is cleaner, as it uses the accessorFn
        const dispatchDate = row.getValue("dispatch_date") as string | undefined;
        return <div>{dispatchDate ? formatDate(dispatchDate) : "N/A"}</div>;
    },
    meta: {
        exportValue: (row: POReportRowData) => {
            const poDoc = row.originalDoc as ProcurementOrder;
            return poDoc.dispatch_date ? formatDate(poDoc.dispatch_date) : "N/A";
        },
        exportHeaderName: "Dispatched Date"
    },
    // This will now receive the correct value from the accessorFn
    filterFn: dateFilterFn,
};


// Function to get columns based on report type
export const getPOReportColumns = (reportType?: ReportType, role?: string): ColumnDef<POReportRowData>[] => {
    let columnsToDisplay: ColumnDef<POReportRowData>[] = (role === "Nirmaan Project Manager Profile" ? [...basePOColumnsForPM] : [...basePOColumns]);
    console.log("reportType", reportType);
    if (reportType === 'Dispatched for 3 days') {
        columnsToDisplay.push(dispatchedDateColumn);
    }
    // You could add more conditional columns here for other report types if needed
    return columnsToDisplay;
};