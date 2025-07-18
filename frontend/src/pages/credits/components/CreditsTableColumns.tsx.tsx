


import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";

import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { PoPaymentTermRow } from "@/types/NirmaanStack/POPaymentTerms"; // Corrected the import path  
import type { NavigateFunction } from "react-router-dom"; // <-- IMPORT THE TYPE FOR NAVIGATE

// src/components/status-badge.tsx

import { Badge, BadgeProps } from "@/components/ui/badge"; // Adjust path if needed
import { cn } from "@/lib/utils";

// Define the props for our component
interface StatusBadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  // We expect a status string
  status: string;
}

// Define the mapping from status to badge variant
// We use BadgeProps["variant"] for type safety
const statusVariantMap: { [key: string]: BadgeProps["variant"] } = {
  Approved: "green",
  Paid: "darkGreen",
  Scheduled: "destructive",
  Requested: "yellow",
  Created: "gray",
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  // Normalize status for lookup (e.g., "approved" -> "Approved")
  const formattedStatus = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();

  // Look up the variant from our map
  // If a status is not in the map, it will fall back to "default" (grey)
  const variant = statusVariantMap[formattedStatus] || "default";

  return (
    // We pass down the className so it can be customized from the outside
    <Badge variant={variant} className={cn("w-20 justify-center capitalize", className)}>
      {status=="Scheduled"?"Due":status}
    </Badge>
  );
}
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
         header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        // header: ({ column }) => (
        //     <div className="flex justify-end">
        //         <DataTableColumnHeader column={column} title="Status" />
        //     </div>
        // ),
        cell: ({ row }) => {
            // 2. Get the status from the row
            const status = row.original.status as string;

            // 3. Render the StatusBadge component in a centered div
            return (
                <div className="flex justify-start">
                    <StatusBadge status={row.original.status} />
                </div>
            );
        },
        enableColumnFilter: true, // This is correct, it enables the filter UI
        filterFn: 'auto', // Keep this or let it default     
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
        id: "due_date",
        accessorKey: "due_date",
        header: ({ column }) => (
             <div className="flex justify-center">
                <DataTableColumnHeader column={column} title="Due Date" />
            </div>
        ),
        cell: ({ row }) => (
            <div className="text-center">{formatDate(row.original.due_date)}</div>
        ),
    }
    
];