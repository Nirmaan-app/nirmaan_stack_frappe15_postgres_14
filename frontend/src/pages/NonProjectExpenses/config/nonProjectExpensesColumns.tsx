// src/pages/NonProjectExpenses/config/nonProjectExpensesColumns.tsx
//
// Column definitions for the Non Project Expenses table, consumed by
// NonProjectExpensesPage.tsx via `getNonProjectExpenseColumns(...)`.
//
// Mirrors the Project Expenses workflow (Requested -> Approved -> Paid) with an
// invoice/payment role split:
//   - Requested -> creator records Invoice Details, Admin approves
//   - Approved  -> Accountant records Payment Details + marks Paid
//   - Paid      -> settled
//
// Column visibility is driven by the active status tab:
//   - "Status"                     -> only on the "All" tab
//   - "Payment Date" / "Payment Ref" -> only on the "Paid" and "All" tabs
// Row actions are derived from each row's own status (so the mixed-status "All"
// tab renders correct actions per row).

import { ColumnDef } from "@tanstack/react-table";
import {
  FileText,
  CheckCircle2,
  IndianRupee,
  Pencil,
  Trash2,
  Download,
  MoreHorizontal,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { formatDate } from "@/utils/FormatDate";
import {
  formatForReport,
  formatToRoundedIndianRupee,
} from "@/utils/FormatPrice";
import { cn } from "@/lib/utils";
import SITEURL from "@/constants/siteURL";
import { NonProjectExpenses } from "@/types/NirmaanStack/NonProjectExpenses";

export interface GetNonProjectExpenseColumnsOptions {
  statusTab: string;
  role?: string;
  getUserName: (id?: string) => string;
  /** Report/embedded mode: hide the Actions column entirely. */
  disableActions?: boolean;
  onEdit: (expense: NonProjectExpenses) => void;
  onApprove: (expense: NonProjectExpenses) => void;
  onRecordInvoice: (expense: NonProjectExpenses) => void;
  onMarkPaid: (expense: NonProjectExpenses) => void;
  onDelete: (expense: NonProjectExpenses) => void;
}

const STATUS_BADGE_STYLES: Record<string, string> = {
  Requested: "bg-amber-100 text-amber-700",
  Approved: "bg-sky-100 text-sky-700",
  Paid: "bg-green-100 text-green-700",
};

export const getNonProjectExpenseColumns = ({
  statusTab,
  role,
  getUserName,
  disableActions = false,
  onEdit,
  onApprove,
  onRecordInvoice,
  onMarkPaid,
  onDelete,
}: GetNonProjectExpenseColumnsOptions): ColumnDef<NonProjectExpenses>[] => {
  // --- Role gating (frontend-only enforcement, mirrors Project Expenses) ---
  const isAdmin = role === "Nirmaan Admin Profile";
  const isPMO = role === "Nirmaan PMO Executive Profile";
  // Accountant Lead mirrors Accountant for role checks (parity by design).
  const isAccountant =
    role === "Nirmaan Accountant Profile" ||
    role === "Nirmaan Accountant Lead Profile";
  const isProcurement = role === "Nirmaan Procurement Executive Profile";
  const isHR = role === "Nirmaan HR Executive Profile";

  // Action-level permissions
  // Requested-stage work (Record Invoice + Edit) is open to the broader creation set
  // (Admin, PMO, Accountant/Lead, Procurement, HR) — mirrors Project Expenses.
  const canRecordInvoice =
    isAdmin || isPMO || isAccountant || isProcurement || isHR;
  const canApprove = isAdmin; // Requested -> Approved (Admin only)
  const canMarkPaid = isAdmin || isAccountant; // Approved -> Paid (records payment)
  const canEdit = isAdmin || isPMO || isProcurement || isHR; // Requested-row edit
  const canDelete = isAdmin; // Delete is Admin only

  // Actions column visibility: shown only to users who can act on the tab's rows.
  // Requested/Approved show it to everyone (gated per button); Paid/All -> Admin only.
  // In report/embedded mode the Actions column is hidden entirely.
  const canSeeActionsColumn = disableActions
    ? false
    : statusTab === "Paid" || statusTab === "All"
      ? isAdmin
      : true;

  // Invoice Ref opens the invoice attachment — only on the Paid and All tabs.
  const invoiceRefClickable = statusTab === "Paid" || statusTab === "All";

  const statusColumn: ColumnDef<NonProjectExpenses> = {
    accessorKey: "status",
    header: "Status",
    size: 130,
    enableColumnFilter: true,
    cell: ({ row }) => {
      const status = row.original.status || "Requested";
      return (
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
            STATUS_BADGE_STYLES[status] || "bg-gray-100 text-gray-700"
          )}
        >
          {status}
        </span>
      );
    },
    meta: {
      exportHeaderName: "Status",
      exportValue: (row: NonProjectExpenses) => row.status || "Requested",
    },
  };

  const typeColumn: ColumnDef<NonProjectExpenses> = {
    accessorKey: "type",
    size: 150,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Expense Type" />
    ),
    cell: ({ row }) => (
      <div className="truncate font-medium" title={row.original.type}>
        {row.original.type || "--"}
      </div>
    ),
    enableColumnFilter: true,
    meta: {
      exportHeaderName: "Expense Type",
      exportValue: (row: NonProjectExpenses) => row.type,
    },
  };

  const descriptionColumn: ColumnDef<NonProjectExpenses> = {
    accessorKey: "description",
    size: 200,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Description" />
    ),
    cell: ({ row }) => (
      <div className="truncate" title={row.original.description}>
        {row.original.description || "--"}
      </div>
    ),
    meta: {
      exportHeaderName: "Description",
      exportValue: (row: NonProjectExpenses) => row.description || "--",
    },
  };

  const commentColumn: ColumnDef<NonProjectExpenses> = {
    accessorKey: "comment",
    size: 180,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Comment" />
    ),
    cell: ({ row }) => (
      <div className="truncate" title={row.original.comment}>
        {row.original.comment || "--"}
      </div>
    ),
    meta: {
      exportHeaderName: "Comment",
      exportValue: (row: NonProjectExpenses) => row.comment || "--",
    },
  };

  const amountColumn: ColumnDef<NonProjectExpenses> = {
    accessorKey: "amount",
    size: 130,
    header: ({ column }) => (
      <DataTableColumnHeader
        column={column}
        title="Amount"
        className="justify-end"
      />
    ),
    cell: ({ row }) => {
      const amount = row.original.amount;
      return (
        <div
          className={cn(
            "font-medium pr-2",
            amount < 0 && "text-green-600 dark:text-green-400"
          )}
        >
          {formatToRoundedIndianRupee(amount)}
        </div>
      );
    },
    meta: {
      exportHeaderName: "Amount",
      exportValue: (row: NonProjectExpenses) => formatForReport(row.amount),
    },
  };

  const invoiceDateColumn: ColumnDef<NonProjectExpenses> = {
    accessorKey: "invoice_date",
    size: 140,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Invoice Date" />
    ),
    cell: ({ row }) => (
      <div className="font-medium">
        {row.original.invoice_date ? formatDate(row.original.invoice_date) : "--"}
      </div>
    ),
    meta: {
      exportHeaderName: "Invoice Date",
      exportValue: (row: NonProjectExpenses) =>
        row.invoice_date ? formatDate(row.invoice_date) : "--",
    },
  };

  const invoiceRefColumn: ColumnDef<NonProjectExpenses> = {
    accessorKey: "invoice_ref",
    size: 150,
    header: "Invoice Ref",
    cell: ({ row }) => {
      const ref = row.original.invoice_ref;
      const attachment = row.original.invoice_attachment;
      // On the Paid/All tabs, link the ref to the invoice attachment (opens in a new tab).
      if (invoiceRefClickable && attachment && ref) {
        return (
          <a
            href={SITEURL + attachment}
            target="_blank"
            rel="noreferrer"
            title={`Open invoice ${ref}`}
            className="block truncate font-medium text-blue-600 underline hover:text-blue-800"
          >
            {ref}
          </a>
        );
      }
      return (
        <div className="font-medium truncate" title={ref}>
          {ref || "--"}
        </div>
      );
    },
    meta: {
      exportHeaderName: "Invoice Ref",
      exportValue: (row: NonProjectExpenses) => row.invoice_ref || "--",
    },
  };

  const paymentDateColumn: ColumnDef<NonProjectExpenses> = {
    accessorKey: "payment_date",
    size: 140,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Payment Date" />
    ),
    cell: ({ row }) => (
      <div className="font-medium">
        {row.original.payment_date ? formatDate(row.original.payment_date) : "--"}
      </div>
    ),
    meta: {
      exportHeaderName: "Payment Date",
      exportValue: (row: NonProjectExpenses) =>
        row.payment_date ? formatDate(row.payment_date) : "--",
    },
  };

  const paymentRefColumn: ColumnDef<NonProjectExpenses> = {
    accessorKey: "payment_ref",
    size: 150,
    header: "Payment Ref",
    cell: ({ row }) => (
      <div className="font-medium truncate" title={row.original.payment_ref}>
        {row.original.payment_ref || "--"}
      </div>
    ),
    meta: {
      exportHeaderName: "Payment Ref",
      exportValue: (row: NonProjectExpenses) => row.payment_ref || "--",
    },
  };

  const createdByColumn: ColumnDef<NonProjectExpenses> = {
    accessorKey: "owner",
    header: "Created By",
    size: 160,
    cell: ({ row }) => (
      <div className="truncate" title={getUserName(row.original.owner)}>
        {getUserName(row.original.owner)}
      </div>
    ),
    enableColumnFilter: true,
    meta: {
      exportHeaderName: "Created By",
      exportValue: (row: NonProjectExpenses) => getUserName(row.owner),
    },
  };

  const invoiceAttachColumn: ColumnDef<NonProjectExpenses> = {
    id: "invoice_attach",
    header: "Inv. Attach",
    size: 110,
    enableSorting: false,
    cell: ({ row }) => {
      const url = row.original.invoice_attachment;
      return url ? (
        <a
          href={SITEURL + url}
          target="_blank"
          rel="noreferrer"
          title="Invoice Document"
          className="inline-flex items-center gap-1 rounded bg-green-50 px-1.5 py-0.5 text-xs font-medium text-green-700 hover:underline"
        >
          <FileText className="h-3.5 w-3.5" /> View
        </a>
      ) : (
        <span className="text-xs text-muted-foreground">--</span>
      );
    },
    meta: { excludeFromExport: true },
  };

  const paymentAttachColumn: ColumnDef<NonProjectExpenses> = {
    id: "payment_attach",
    header: "Pay. Attach",
    size: 110,
    enableSorting: false,
    cell: ({ row }) => {
      const url = row.original.payment_attachment;
      return url ? (
        <a
          href={SITEURL + url}
          target="_blank"
          rel="noreferrer"
          title="Payment Proof"
          className="inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-700 hover:underline"
        >
          <Download className="h-3.5 w-3.5" /> View
        </a>
      ) : (
        <span className="text-xs text-muted-foreground">--</span>
      );
    },
    meta: { excludeFromExport: true },
  };

  const actionsColumn: ColumnDef<NonProjectExpenses> = {
    id: "actions",
    size: 90,
    enableSorting: false,
    header: () => <div className="text-right">Actions</div>,
    cell: ({ row }) => {
      const expense = row.original;
      const status = expense.status || "Requested";
      return (
        <div className="text-right">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <span className="sr-only">Open menu</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {status === "Requested" && (
                <>
                  {canRecordInvoice && (
                    <DropdownMenuItem onClick={() => onRecordInvoice(expense)}>
                      <FileText className="mr-2 h-4 w-4" /> Record Invoice
                    </DropdownMenuItem>
                  )}
                  {canApprove && (
                    <DropdownMenuItem onClick={() => onApprove(expense)}>
                      <CheckCircle2 className="mr-2 h-4 w-4" /> Approve
                    </DropdownMenuItem>
                  )}
                  {canEdit && (
                    <DropdownMenuItem onClick={() => onEdit(expense)}>
                      <Pencil className="mr-2 h-4 w-4" /> Edit
                    </DropdownMenuItem>
                  )}
                </>
              )}

              {status === "Approved" && canMarkPaid && (
                <DropdownMenuItem onClick={() => onMarkPaid(expense)}>
                  <IndianRupee className="mr-2 h-4 w-4" /> Mark as Paid
                </DropdownMenuItem>
              )}

              {/* A Paid expense can only be edited by an Admin */}
              {status === "Paid" && isAdmin && (
                <DropdownMenuItem onClick={() => onEdit(expense)}>
                  <Pencil className="mr-2 h-4 w-4" /> Edit
                </DropdownMenuItem>
              )}

              {canDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => onDelete(expense)}
                    className="text-destructive focus:text-destructive focus:bg-destructive/10"
                  >
                    <Trash2 className="mr-2 h-4 w-4" /> Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      );
    },
    meta: { excludeFromExport: true },
  };

  return [
    typeColumn,
    ...(statusTab === "All" ? [statusColumn] : []),
    descriptionColumn,
    commentColumn,
    amountColumn,
    invoiceDateColumn,
    invoiceRefColumn,
    // Inv. Attach only on tabs where Invoice Ref is NOT the clickable link (Requested/Approved);
    // on Paid/All the clickable Invoice Ref already opens the invoice attachment.
    ...(!invoiceRefClickable ? [invoiceAttachColumn] : []),
    ...(statusTab === "Paid" || statusTab === "All"
      ? [paymentDateColumn, paymentRefColumn, paymentAttachColumn]
      : []),
    createdByColumn,
    ...(canSeeActionsColumn ? [actionsColumn] : []),
  ];
};
