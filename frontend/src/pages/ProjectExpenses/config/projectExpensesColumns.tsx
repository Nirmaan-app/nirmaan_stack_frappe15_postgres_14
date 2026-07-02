// src/pages/ProjectExpenses/config/projectExpensesColumns.tsx
//
// Column definitions for the Project Expenses table, consumed by
// ProjectExpensesList.tsx via `getProjectExpenseColumns(...)`.
//
// Column visibility is driven by the active status tab:
//   - "Project"  -> only on the global list (no projectId)
//   - "Created By" (owner)      -> all tabs EXCEPT "Paid"
//   - "Payment By" + "Payment Date" -> only on the "Paid" tab
//   - "Status"   -> only on the "All" tab (other tabs are already status-scoped)
// The faceted-filter / date-filter wiring in ProjectExpensesList keys off these
// column ids (projects, type, vendor, owner, payment_by, status, payment_date).
//
// Row actions are derived from each row's own status (so the mixed-status "All"
// tab renders correct actions per row):
//   - Requested -> Edit, Approve, Delete
//   - Approved  -> Mark as Paid, Delete
//   - Paid      -> Delete

import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { Pencil, CheckCircle2, IndianRupee, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { formatDate } from "@/utils/FormatDate";
import {
  formatForReport,
  formatToRoundedIndianRupee,
} from "@/utils/FormatPrice";
import { cn } from "@/lib/utils";
import { ProjectExpenses } from "@/types/NirmaanStack/ProjectExpenses";

export interface GetProjectExpenseColumnsOptions {
  statusTab: string;
  projectId?: string;
  role?: string;
  // When true, never render the Actions column (used by the read-only embedded
  // project view).
  disableActions?: boolean;
  getProjectName: (id?: string) => string;
  getVendorName: (id?: string) => string;
  getUserName: (id?: string) => string;
  onEdit: (expense: ProjectExpenses) => void;
  onApprove: (expense: ProjectExpenses) => void;
  onMarkPaid: (expense: ProjectExpenses) => void;
  onDelete: (expense: ProjectExpenses) => void;
}

const STATUS_BADGE_STYLES: Record<string, string> = {
  Requested: "bg-amber-100 text-amber-700",
  Approved: "bg-sky-100 text-sky-700",
  Paid: "bg-green-100 text-green-700",
};

export const getProjectExpenseColumns = ({
  statusTab,
  projectId,
  role,
  disableActions = false,
  getProjectName,
  getVendorName,
  getUserName,
  onEdit,
  onApprove,
  onMarkPaid,
  onDelete,
}: GetProjectExpenseColumnsOptions): ColumnDef<ProjectExpenses>[] => {
  // --- Role gating (frontend-only enforcement, mirrors the existing flow) ---
  const isAdmin = role === "Nirmaan Admin Profile";
  const isPMO = role === "Nirmaan PMO Executive Profile";
  // Accountant Lead mirrors Accountant for role checks (parity by design).
  const isAccountant =
    role === "Nirmaan Accountant Profile" ||
    role === "Nirmaan Accountant Lead Profile";
  const isProcurement = role === "Nirmaan Procurement Executive Profile";
  const isHR = role === "Nirmaan HR Executive Profile";

  // Action-level permissions
  // Editing a *Requested* expense is allowed for the broader managing set
  // (Admin, PMO, Accountant/Lead, Procurement, HR). Paid-row edit stays Admin-only.
  const canEditRequested =
    isAdmin || isPMO || isAccountant || isProcurement || isHR;
  const canApprove = isAdmin; // Requested -> Approved (Admin only)
  const canMarkPaid = isAdmin || isAccountant; // Approved -> Paid (Accountant now allowed)
  const canDelete = isAdmin; // Delete is Admin only (PMO removed)

  // --- Actions column visibility (scoped to the Paid and All tabs) ---
  // The column shows only for users who can actually act on the tab's rows:
  //   - Paid tab: Edit/Delete are Admin-only, so only Admin sees it.
  //   - All tab:  Admin, plus Accountant (who can Mark as Paid the Approved rows).
  // Requested/Approved tabs are left unchanged (column always present).
  const canSeeActionsColumn = disableActions
    ? false
    : statusTab === "Paid"
      ? isAdmin
      : statusTab === "All"
        ? isAdmin
        : true;

  const projectColumn: ColumnDef<ProjectExpenses> = {
    accessorKey: "projects",
    size: 180,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Project" />
    ),
    cell: ({ row }) => (
      <Link
        to={`/projects/${row.original.projects}`}
        className="text-blue-600 hover:underline"
      >
        {getProjectName(row.original.projects)}
      </Link>
    ),
    enableColumnFilter: true,
    meta: { exportValue: (row: ProjectExpenses) => getProjectName(row.projects) },
  };

  const expenseTypeColumn: ColumnDef<ProjectExpenses> = {
    accessorKey: "type",
    header: "Expense Type",
    size: 150,
    cell: ({ row }) => (
      <div
        className="truncate"
        title={row.original.expense_type_name || row.original.type}
      >
        {row.original.expense_type_name || row.original.type || "--"}
      </div>
    ),
    enableColumnFilter: true,
    meta: {
      exportValue: (row: ProjectExpenses) =>
        row.expense_type_name || row.type || "--",
    },
  };

  const descriptionColumn: ColumnDef<ProjectExpenses> = {
    accessorKey: "description",
    header: "Description",
    size: 200,
    cell: ({ row }) => (
      <div className="truncate" title={row.original.description}>
        {row.original.description || "--"}
      </div>
    ),
  };

  const commentColumn: ColumnDef<ProjectExpenses> = {
    accessorKey: "comment",
    header: "Comment",
    size: 200,
    cell: ({ row }) => (
      <div className="truncate" title={row.original.comment}>
        {row.original.comment || "--"}
      </div>
    ),
  };

  const vendorColumn: ColumnDef<ProjectExpenses> = {
    accessorKey: "vendor",
    header: "Vendor",
    size: 170,
    cell: ({ row }) => (
      <div className="truncate" title={getVendorName(row.original.vendor)}>
        {getVendorName(row.original.vendor)}
      </div>
    ),
    enableColumnFilter: true,
    meta: { exportValue: (row: ProjectExpenses) => getVendorName(row.vendor) },
  };

  const amountColumn: ColumnDef<ProjectExpenses> = {
    accessorKey: "amount",
    size: 130,
    header: ({ column }) => (
      <DataTableColumnHeader
        column={column}
        title="Amount"
        className="justify-center"
      />
    ),
    cell: ({ row }) => (
      <div className="font-medium pr-2">
        {formatToRoundedIndianRupee(row.original.amount)}
      </div>
    ),
    meta: { exportValue: (row: ProjectExpenses) => formatForReport(row.amount) },
  };

  const createdByColumn: ColumnDef<ProjectExpenses> = {
    accessorKey: "owner",
    header: "Created By",
    size: 160,
    cell: ({ row }) => (
      <div className="truncate" title={getUserName(row.original.owner)}>
        {getUserName(row.original.owner)}
      </div>
    ),
    enableColumnFilter: true,
    meta: { exportValue: (row: ProjectExpenses) => getUserName(row.owner) },
  };

  const paymentByColumn: ColumnDef<ProjectExpenses> = {
    accessorKey: "payment_by",
    header: "Payment By",
    size: 160,
    cell: ({ row }) => (
      <div className="truncate" title={getUserName(row.original.payment_by)}>
        {getUserName(row.original.payment_by)}
      </div>
    ),
    enableColumnFilter: true,
    meta: { exportValue: (row: ProjectExpenses) => getUserName(row.payment_by) },
  };

  const paymentDateColumn: ColumnDef<ProjectExpenses> = {
    accessorKey: "payment_date",
    size: 150,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Payment Date" />
    ),
    cell: ({ row }) => (
      <div className="font-medium">
        {row.original.payment_date ? formatDate(row.original.payment_date) : "--"}
      </div>
    ),
    meta: {
      exportValue: (row: ProjectExpenses) =>
        row.payment_date ? formatDate(row.payment_date) : "--",
    },
  };

  const statusColumn: ColumnDef<ProjectExpenses> = {
    accessorKey: "status",
    header: "Status",
    size: 140,
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
    meta: { exportValue: (row: ProjectExpenses) => row.status || "Requested" },
  };

  const actionsColumn: ColumnDef<ProjectExpenses> = {
    id: "actions",
    size: 150,
    enableSorting: false,
    header: ({ column }) => (
      <DataTableColumnHeader
        column={column}
        title="Actions"
        className="text-center"
      />
    ),
    cell: ({ row }) => {
      const expense = row.original;
      const status = expense.status || "Requested";
      return (
        <TooltipProvider delayDuration={300}>
          <div className="flex items-center gap-1">
            {status === "Requested" && (
              <>
                {canEditRequested && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        onClick={() => onEdit(expense)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="bg-white text-gray-900 border shadow-lg">Edit</TooltipContent>
                  </Tooltip>
                )}
                {canApprove && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        className="h-8 w-8 p-0 text-green-600 hover:text-green-700"
                        onClick={() => onApprove(expense)}
                      >
                        <CheckCircle2 className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="bg-white text-gray-900 border shadow-lg">Approve</TooltipContent>
                  </Tooltip>
                )}
              </>
            )}

            {status === "Approved" && canMarkPaid && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    className="h-8 bg-green-600 text-white hover:bg-green-700"
                    onClick={() => onMarkPaid(expense)}
                  >
                    <IndianRupee className="mr-1 h-3.5 w-3.5" />
                    Mark as Paid
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="bg-white text-gray-900 border shadow-lg">Mark as Paid</TooltipContent>
              </Tooltip>
            )}

            {/* A Paid expense can only be edited by an Admin */}
            {status === "Paid" && isAdmin && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    className="h-8 w-8 p-0"
                    onClick={() => onEdit(expense)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="bg-white text-gray-900 border shadow-lg">Edit</TooltipContent>
              </Tooltip>
            )}

            {canDelete && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                    onClick={() => onDelete(expense)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="bg-white text-gray-900 border shadow-lg">Delete</TooltipContent>
              </Tooltip>
            )}
          </div>
        </TooltipProvider>
      );
    },
    meta: { excludeFromExport: true },
  };

  return [
    ...(!projectId ? [projectColumn] : []),
    expenseTypeColumn,
    descriptionColumn,
    commentColumn,
    vendorColumn,
    amountColumn,
    ...(statusTab !== "Paid" ? [createdByColumn] : []),
    // "All" tab also shows Payment By (right after Created By); blank for non-paid rows
    ...(statusTab === "All" ? [paymentByColumn] : []),
    ...(statusTab === "Paid" ? [paymentByColumn, paymentDateColumn] : []),
    ...(statusTab === "All" ? [statusColumn] : []),
    ...(canSeeActionsColumn ? [actionsColumn] : []),
  ];
};
