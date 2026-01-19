import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  PencilIcon,
  MoreHorizontal,
  DollarSign,
} from "lucide-react";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { facetedFilterFn } from "@/utils/tableFilters";
import { PoPaymentTermRow } from "@/types/NirmaanStack/POPaymentTerms";
import type { NavigateFunction } from "react-router-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
  Due: "destructive",      // Created terms with past due_date - shown in red
  Approved: "green",
  Paid: "darkGreen",
  Requested: "yellow",
  Created: "gray",
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  // Normalize status for lookup (e.g., "approved" -> "Approved")
  const formattedStatus =
    status?.charAt(0).toUpperCase() + status?.slice(1).toLowerCase();

  // Look up the variant from our map
  // If a status is not in the map, it will fall back to "default" (grey)
  const variant = statusVariantMap[formattedStatus] || "default";

  return (
    <Badge
      variant={variant}
      className={cn("w-20 justify-center capitalize", className)}
    >
      {status}
    </Badge>
  );
}
// Exporting columns as a function or a constant is a great pattern.
export const getCreditsColumns = (
  navigate: NavigateFunction,
  onRequestPayment: (term: PoPaymentTermRow) => void,
  currentStatus: string
): ColumnDef<PoPaymentTermRow>[] => {

  const columns: ColumnDef<PoPaymentTermRow>[] = [
    {
      accessorKey: "name",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="PO Number" />
      ),
      cell: ({ row }) => {
        // URL-encode the name to handle special characters like "/"
        const { name, postatus } = row.original;
        const encodedPoName = name.replace(/\//g, "&="); // Encode slashes
        const encodedPoStatus = postatus?.replace(" ", "%20");
        // console.log("status", currentStatus)

        return (
          <Link
            to="#" // Use a placeholder link
            onClick={(e) => {
              e.preventDefault(); // Prevent default link behavior
              // Use the navigate function that was passed in
              navigate(`/purchase-orders/${encodedPoName}?tab=${encodedPoStatus}`)
            }}
            className="text-blue-600 hover:underline font-mono"
          >
            {/* Display the original, un-encoded name */}
            {row.original.name}
          </Link>
          // <div>
          //     {row.original.name}
          // </div>
        );
      },
    },
    {
      // Text -> Left Align (Default)
      accessorKey: "vendor_name",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Vendor" />
      ),
      enableColumnFilter: true, // This is correct, it enables the filter UI
    },
    {
      // Text -> Left Align (Default)
      accessorKey: "project_name",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Project" />
      ),
      enableColumnFilter: true, // This is correct, it enables the filter UI
    },

    {
      // Badge -> Center Align
      // Uses display_status which shows "Due" for Created terms with past due_date
      accessorKey: "display_status",
      id: "display_status",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
      cell: ({ row }) => {
        // display_status is computed by backend: "Due" for Created+past due, else term_status
        const status = row.original.display_status as string;
        return (
          <div className="flex justify-start">
            <StatusBadge status={status} />
          </div>
        );
      },
      enableColumnFilter: true,
      filterFn: facetedFilterFn,
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
          <DataTableColumnHeader column={column} title="Due Amount" />
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
      accessorKey: "due_date",
      header: ({ column }) => (
        <div className="flex justify-center">
          <DataTableColumnHeader column={column} title="Due Date" />
        </div>
      ),
      cell: ({ row }) => (
        <div className="text-left">{formatDate(row.original.due_date)}</div>
      ),
    },
    // ...(currentStatus=="Scheduled"?[
    //   {
    //     accessorKey: "ptname",
    //     header: () => (
    //       <div className=" text-center flex justify-end">
    //         {/* <DataTableColumnHeader column={column} title="Actions" />
    //          */}
    //         Actions
    //       </div>
    //     ),
    //     cell: ({ row }) => {
    //       const status = row.original.status;
    //       const postatus= row.original.postatus?.replace(" ","%20"); 
    //        const encodedPoName = encodeURIComponent(row.original.name);
    //        console.log("status",currentStatus)
    //       return (
    //         <div className="text-center font-mono pr-4">
    //             {status=="Scheduled"?(
    //  <DropdownMenu>
    //             <DropdownMenuTrigger asChild>
    //               <Button variant="ghost" className="h-8 w-4 p-0">
    //                 <span className="sr-only">Open menu</span>
    //                 <MoreHorizontal className="h-4 w-4" />
    //               </Button>
    //             </DropdownMenuTrigger>
    //             <DropdownMenuContent align="start">
    //               {/* {role === "Nirmaan Admin Profile" && <DropdownMenuItem onClick={() => handleOpenEditDialog(expense)}>
    //                                         <PencilIcon className="mr-2 h-4 w-4" /> Edit Expense
    //                                     </DropdownMenuItem>} */}
    //               <DropdownMenuItem
    //                 className="p-0" // Remove padding to let our custom style take over
    //               >
    //                 {/* The 'w-full' makes the entire menu item clickable */}
    //                 <div
    //                   className="flex items-center px-2 py-1.5 text-sm w-full cursor-pointer text-green-700 font-semibold"
    //                   onClick={() => onRequestPayment(row.original)}
    //                 >
    //                   <DollarSign className="mr-2 h-4 w-4" />
    //                   <span>Request Payment</span>
    //                 </div>
    //               </DropdownMenuItem>
    //               <DropdownMenuSeparator />
    //               <DropdownMenuItem
    //                 onClick={(e) => {e.preventDefault(); // Prevent default link behavior
    //             // Use the navigate function that was passed in
    //             navigate(`/purchase-orders/${encodedPoName}?tab=${postatus}&isEditing=true`)}}
    //                 className="cursor-pointer"
    //               >
    //                 <PencilIcon className="mr-2 h-4 w-4" />
    //                 <span>Reschedule / Edit</span>
    //               </DropdownMenuItem>

    //             </DropdownMenuContent>
    //           </DropdownMenu>
    //             ):"--"}

    //         </div>
    //       );
    //     },
    //     meta: { excludeFromExport: true },
    //   },
    // ]:[])

  ];


  // Action column for "Due" tab
  // Shows actions for terms that are eligible for payment requests:
  // - "Due" status (Created with past due_date) -> Request Payment + Edit
  // - "Requested" / "Approved" -> View only (no actions)
  if (currentStatus === "Due") {
    columns.push({
      id: "actions",
      header: () => <div className="text-center">Actions</div>,
      cell: ({ row }) => {
        const { display_status, name, postatus } = row.original;
        const encodedPoName = name.replace(/\//g, "&="); // Encode slashes
        const encodedPoStatus = postatus?.replace(" ", "%20");

        return (
          <div className="flex justify-center">
            {/* Only "Due" status terms (Created with past due_date) can request payment */}
            {display_status === "Due" ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="h-8 w-8 p-0">
                    <span className="sr-only">Open menu</span>
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => onRequestPayment(row.original)}
                    className="cursor-pointer text-green-700 font-semibold focus:text-green-800 focus:bg-green-50"
                  >
                    <DollarSign className="mr-2 h-4 w-4" />
                    <span>Request Payment</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => navigate(`/purchase-orders/${encodedPoName}?tab=${encodedPoStatus}&isEditing=true`)}
                    className="cursor-pointer"
                  >
                    <PencilIcon className="mr-2 h-4 w-4" />
                    <span>Edit Payment Term</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <span className="text-gray-400">--</span>
            )}
          </div>
        );
      },
      meta: { excludeFromExport: true },
    });
  }


  return columns;
};
