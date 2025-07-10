// src/features/credits/components/CreditsTableColumns.tsx

import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { PoPaymentTermRow } from "@/types/NirmaanStack/POPaymentTerms"; // Corrected the import path  
import type { NavigateFunction } from "react-router-dom"; // <-- IMPORT THE TYPE FOR NAVIGATE

// Exporting columns as a function or a constant is a great pattern.
export const getCreditsColumns = (navigate: NavigateFunction): ColumnDef<PoPaymentTermRow>[] => [
   {
        accessorKey: "name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="PO Number" />,
        cell: ({ row }) => {
            // URL-encode the name to handle special characters like "/"
            const encodedPoName = encodeURIComponent(row.original.name);

            return (
                <Link
                    to="#" // Use a placeholder link
                    onClick={(e) => {
                        e.preventDefault(); // Prevent default link behavior
                        // Use the navigate function that was passed in
                        navigate(`/purchase-orders/${encodedPoName}?tab=PO%20Approved`);
                    }}
                    className="text-blue-600 hover:underline font-mono"
                >
                    {/* Display the original, un-encoded name */}
                    {row.original.name}
                </Link>
            );
        },
    },
    {
        // Text -> Left Align (Default)
        accessorKey: "vendor_name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Vendor" />,
    },
    {
        // Text -> Left Align (Default)
        accessorKey: "project_name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
    },
    {
        // Badge -> Center Align
        accessorKey: "status",
        header: ({ column }) => (
            <div className="flex justify-center">
                <DataTableColumnHeader column={column} title="Status" />
            </div>
        ),
        cell: ({ row }) => {
            const status = row.original.status;
            return (
                <div className="text-left">
                    <Badge className="w-20 justify-center">
                        {status}
                    </Badge>
                </div>
            );
        },
    },
    {
        // Number -> Right Align
        accessorKey: "total_amount",
        header: ({ column }) => (
            <div className="flex justify-end">
                <DataTableColumnHeader column={column} title="PO Amount" />
            </div>
        ),
        cell: ({ row }) => (
            <div className="text-left font-mono pr-4">
                {formatToRoundedIndianRupee(row.original.total_amount)}
            </div>
        ),
    },
    {
        // Number -> Right Align
        accessorKey: "amount",
        header: ({ column }) => (
             <div className="flex justify-end">
                <DataTableColumnHeader column={column} title="Amount" />
            </div>
        ),
        cell: ({ row }) => (
            <div className="text-left font-mono pr-4">
                {formatToRoundedIndianRupee(row.original.amount)}
            </div>
        ),
    },
    {
        // Date -> Center Align
        id: "`tabPO Payment Terms`.due_date",
        accessorKey: "due_date",
        header: ({ column }) => (
             <div className="flex justify-center">
                <DataTableColumnHeader column={column} title="Due Date" />
            </div>
        ),
        cell: ({ row }) => (
            <div className="text-center">{formatDate(row.original.due_date)}</div>
        ),
    },
    {
        // Text -> Left Align (Default)
        accessorKey: "payment_type",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Payment Type" />,
    },
];