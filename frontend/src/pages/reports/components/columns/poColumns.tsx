import { ColumnDef } from "@tanstack/react-table";
import { POReportRowData } from "../../hooks/usePOReportsData"; // Adjust path
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { formatDate } from "@/utils/FormatDate";

export const poColumns: ColumnDef<POReportRowData>[] = [
    {
        accessorKey: "name",
        header: "#PO",
        cell: ({ row }) => {
            const name = row.original.name;
            // const type = row.original.type;
            // Optional: Link to PO/SR document page
            // const doctypeLink = type === 'PO' ? 'procurement-orders' : 'service-requests';
            // return <Link href={`/${doctypeLink}/${name}`}>{name}</Link>;
             return <div>{name}</div>;
        },
    },
    {
        accessorKey: "creation",
        header: "Date Created",
        cell: ({ row }) => {
            const date = row.original.creation;
            return <div>{formatDate(date)}</div>;
        },
        meta: {
            exportValue: (row: POReportRowData) => formatDate(row.creation),
        }
    },
    {
        accessorKey: "projectName",
        header: "Project",
        cell: ({ row }) => {
            return <div>{row.original.projectName || row.original.project}</div>;
        },
    },
    {
        accessorKey: "vendorName",
        header: "Vendor",
         cell: ({ row }) => {
            return <div>{row.original.vendorName || row.original.vendor}</div>;
        },
    },
    {
        accessorKey: "totalAmount",
        header: "Total PO Amt",
        cell: ({ row }) => {
            const amount = row.original.totalAmount;
            return <div className="">{formatToRoundedIndianRupee(amount)}</div>;
        },
        meta: {
          // Use the SAME formatter for export (remove Rupee symbol if desired for CSV)
             // Assuming formatToRoundedIndianRupee returns "₹X,XX,XXX"
             // Option 1: Keep Rupee symbol in CSV
             exportValue: (row: POReportRowData) => formatToRoundedIndianRupee(row.totalAmount)
             // Option 2: Remove Rupee symbol for CSV (cleaner for data analysis)
             // exportValue: (row) => formatToRoundedIndianRupee(row.original.totalAmount).replace('₹', '').trim()
        }
    },
    {
        accessorKey: "invoiceAmount",
        header: "Total Invoice Amt",
        cell: ({ row }) => {
            const amount = row.original.invoiceAmount;
             return <div className="">{formatToRoundedIndianRupee(amount)}</div>;
        },
        meta: {
          // Use the SAME formatter for export (remove Rupee symbol if desired for CSV)
             // Assuming formatToRoundedIndianRupee returns "₹X,XX,XXX"
             // Option 1: Keep Rupee symbol in CSV
             exportValue: (row: POReportRowData) => formatToRoundedIndianRupee(row.invoiceAmount)
             // Option 2: Remove Rupee symbol for CSV (cleaner for data analysis)
             // exportValue: (row) => formatToRoundedIndianRupee(row.original.totalAmount).replace('₹', '').trim()
        }
    },
    {
        accessorKey: "amountPaid",
        header: "Amt Paid",
         cell: ({ row }) => {
            const amount = row.original.amountPaid;
             return <div className="">{formatToRoundedIndianRupee(amount)}</div>;
        },
        meta: {
          // Use the SAME formatter for export (remove Rupee symbol if desired for CSV)
             // Assuming formatToRoundedIndianRupee returns "₹X,XX,XXX"
             // Option 1: Keep Rupee symbol in CSV
             exportValue: (row: POReportRowData) => formatToRoundedIndianRupee(row.amountPaid)
             // Option 2: Remove Rupee symbol for CSV (cleaner for data analysis)
             // exportValue: (row) => formatToRoundedIndianRupee(row.original.totalAmount).replace('₹', '').trim()
        }
    },
];