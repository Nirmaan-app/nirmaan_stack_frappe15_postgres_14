import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  PencilIcon,
  MoreHorizontal,
  DollarSign,
} from "lucide-react";
import { PayByChequeButton } from "@/pages/ProjectPayments/components/PayByChequeButton";
import { ChequeStatusBadge } from "@/components/cheques/ChequeStatusBadge";
import { ChequeNumberLink } from "@/components/cheques/ChequeChip";
import type { ChequeStatus } from "@/types/NirmaanStack/Cheques";
import { isEarlyCreditCheque, todayDay } from "@/pages/ProjectPayments/creditCheque";
import { CREDIT_TAB_CHEQUE_ISSUED } from "../credits.constant";
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
import { ReconciliationPendingBadge } from "@/pages/ProjectPayments/components/ReconciliationPendingBadge";

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
  "Ceo pending": "blue",
  Paid: "darkGreen",
  Requested: "yellow",
  Created: "gray",
  Rejected: "red",
  Return: "orange",
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  // The same two-line badge the PO page's payment terms show (most Cheque Issued rows wait here).
  if (status === "Reconciliation Pending") return <ReconciliationPendingBadge />;

  // Normalize status for lookup. Multi-word statuses like "CEO Pending" → "Ceo pending"
  // (capitalize first letter, lowercase the rest — matches the keys above).
  const formattedStatus =
    status?.charAt(0).toUpperCase() + status?.slice(1).toLowerCase();

  // Look up the variant from our map
  // If a status is not in the map, it will fall back to "default" (grey)
  const variant = statusVariantMap[formattedStatus] || "default";

  return (
    <Badge
      variant={variant}
      className={cn("min-w-20 justify-center whitespace-nowrap capitalize", className)}
    >
      {status}
    </Badge>
  );
}
// Exporting columns as a function or a constant is a great pattern.
export const getCreditsColumns = (
  navigate: NavigateFunction,
  onRequestPayment: (term: PoPaymentTermRow) => void,
  currentStatus: string,
  /** Admin, PMO and Procurement see Pay by Cheque on All Credits (`creditCheque.canPayCreditByCheque`). */
  canPayByCheque: boolean
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

  // Cheque Issued tab: the cheque paying each term; its number opens the cheque's detail view.
  if (currentStatus === CREDIT_TAB_CHEQUE_ISSUED) {
    columns.push(
      {
        accessorKey: "cheque_no",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Cheque No" />,
        cell: ({ row }) => {
          const chequeNo = row.original.cheque_no;
          return chequeNo ? (
            <ChequeNumberLink cheque={row.original.cheque} chequeNo={chequeNo} />
          ) : (
            <span className="text-gray-400">--</span>
          );
        },
        enableSorting: false,
      },
      {
        accessorKey: "cheque_date",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Cheque Date" />,
        cell: ({ row }) => (
          <div className="text-left">{row.original.cheque_date ? formatDate(row.original.cheque_date) : "--"}</div>
        ),
        enableSorting: false,
      },
      {
        accessorKey: "cheque_status",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Cheque Status" />,
        cell: ({ row }) =>
          row.original.cheque_status ? (
            <ChequeStatusBadge status={row.original.cheque_status as ChequeStatus} />
          ) : (
            <span className="text-gray-400">--</span>
          ),
        enableSorting: false,
      }
    );
  }

  // The Due tab's "..." menu for a Due term (Created, past its due date): Request Payment and Edit Payment Term.
  const dueMenu = (term: PoPaymentTermRow) => {
    const encodedPoName = term.name.replace(/\//g, "&="); // Encode slashes
    const encodedPoStatus = term.postatus?.replace(" ", "%20");
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-8 w-8 p-0">
            <span className="sr-only">Open menu</span>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={() => onRequestPayment(term)}
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
    );
  };
  const none = <span className="text-gray-400">--</span>;

  // All Credits tab (owner, 2026-10-31): a Due term gets the Due tab's menu; a Created term not due yet, Pay by
  // Cheque for Admin, PMO and Procurement (`canPayByCheque`); any other row "--".
  if (currentStatus === "All") {
    columns.push({
      id: "actions",
      header: () => <div className="text-center">Actions</div>,
      cell: ({ row }) => {
        const term = row.original;
        const early = canPayByCheque && term.term_status === "Created" && isEarlyCreditCheque(term, todayDay());
        return (
          <div className="flex justify-center">
            {term.display_status === "Due" ? dueMenu(term) : early ? (
              <PayByChequeButton onClick={() => onRequestPayment(term)} />
            ) : none}
          </div>
        );
      },
      meta: { excludeFromExport: true },
    });
  }

  // Due tab: only a Due term (Created, past its due date) can be requested; Requested / Approved rows are view only.
  if (currentStatus === "Due") {
    columns.push({
      id: "actions",
      header: () => <div className="text-center">Actions</div>,
      cell: ({ row }) => (
        <div className="flex justify-center">
          {row.original.display_status === "Due" ? dueMenu(row.original) : none}
        </div>
      ),
      meta: { excludeFromExport: true },
    });
  }

  return columns;
};
