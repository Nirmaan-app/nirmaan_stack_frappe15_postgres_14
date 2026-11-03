/**
 * Columns of the Pending Invoices Upload -> Cashbook table (#1604): Date, Amount, Paid by, Remark, Project,
 * Expense Type and the actions, on the same shared DataTable as the Credit Card tab (`cardInvoiceColumns.tsx`).
 *
 * Search covers Paid by, Remark, Project and Expense Type only (`enableGlobalFilter` off elsewhere), so a typed
 * amount or date never matches by accident. Paid by, Project and Expense Type carry column filters, Date a
 * date-range filter, Date and Amount sort. Export reads each column's `meta`.
 *
 * Every column sets `size`: the shared table is `table-fixed` and gives an unsized column 150px.
 */
import { ColumnDef } from "@tanstack/react-table";

import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee, { formatForReport } from "@/utils/FormatPrice";
import { dateFilterFn, facetedFilterFn } from "@/utils/tableFilters";

import { type CashbookInvoiceRow, cashbookExpenseTypeLabel, cashbookProjectLabel } from "../utils/cashbookInvoicesView";

interface CashbookInvoiceColumnOptions {
    /** Which row actions the user gets (`cashbookInvoiceActions`). */
    actions: { attach: boolean; noInvoice: boolean };
    onAttach: (row: CashbookInvoiceRow) => void;
    onNoInvoice: (row: CashbookInvoiceRow) => void;
}

export const getCashbookInvoiceColumns = ({
    actions, onAttach, onNoInvoice,
}: CashbookInvoiceColumnOptions): ColumnDef<CashbookInvoiceRow>[] => [
    {
        accessorKey: "payment_date",
        size: 115,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
        cell: ({ row }) => <div className="whitespace-nowrap">{formatDate(row.original.payment_date)}</div>,
        filterFn: dateFilterFn,
        enableGlobalFilter: false,
        meta: {
            exportHeaderName: "Date",
            exportValue: (row: CashbookInvoiceRow) => formatDate(row.payment_date),
        },
    },
    {
        accessorKey: "amount",
        size: 115,
        header: ({ column }) => (
            <div className="w-full flex justify-end">
                <DataTableColumnHeader column={column} title="Amount" />
            </div>
        ),
        cell: ({ row }) => (
            <div className="text-right whitespace-nowrap tabular-nums">{formatToIndianRupee(row.original.amount)}</div>
        ),
        enableGlobalFilter: false,
        meta: {
            exportHeaderName: "Amount",
            exportValue: (row: CashbookInvoiceRow) => formatForReport(row.amount),
            isNumeric: true,
        },
    },
    {
        id: "paid_by",
        size: 150,
        accessorFn: (row) => row.paid_by ?? "",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Paid by" />,
        cell: ({ row }) => <div className="whitespace-nowrap truncate">{row.original.paid_by || "--"}</div>,
        filterFn: facetedFilterFn,
        meta: {
            exportHeaderName: "Paid by",
            exportValue: (row: CashbookInvoiceRow) => row.paid_by ?? "",
        },
    },
    {
        accessorKey: "remark",
        size: 260,
        header: "Remark",
        cell: ({ row }) => <div className="truncate" title={row.original.remark}>{row.original.remark || "--"}</div>,
        enableSorting: false,
        meta: {
            exportHeaderName: "Remark",
            exportValue: (row: CashbookInvoiceRow) => row.remark ?? "",
        },
    },
    {
        // Blank for a Non-Project spend: the Project / Non-Project dropdown beside the search box picks the ledger.
        id: "project",
        size: 200,
        accessorFn: (row) => cashbookProjectLabel(row),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
        cell: ({ row }) => <div className="truncate" title={cashbookProjectLabel(row.original)}>{cashbookProjectLabel(row.original)}</div>,
        filterFn: facetedFilterFn,
        meta: {
            exportHeaderName: "Project",
            exportValue: (row: CashbookInvoiceRow) => cashbookProjectLabel(row),
        },
    },
    {
        id: "expense_type",
        size: 180,
        accessorFn: (row) => cashbookExpenseTypeLabel(row),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Expense Type" />,
        cell: ({ row }) => <div>{cashbookExpenseTypeLabel(row.original)}</div>,
        filterFn: facetedFilterFn,
        meta: {
            exportHeaderName: "Expense Type",
            exportValue: (row: CashbookInvoiceRow) => cashbookExpenseTypeLabel(row),
        },
    },
    {
        id: "actions",
        size: 230,
        header: () => <div className="text-right">Actions</div>,
        cell: ({ row }) => (
            <div className="flex justify-end gap-2 whitespace-nowrap">
                {actions.attach && (
                    <Button size="sm" variant="outline" onClick={() => onAttach(row.original)}>
                        Attach invoice
                    </Button>
                )}
                {actions.noInvoice && (
                    <Button size="sm" variant="ghost" onClick={() => onNoInvoice(row.original)}>
                        No invoice
                    </Button>
                )}
            </div>
        ),
        enableSorting: false,
        enableGlobalFilter: false,
        meta: { excludeFromExport: true },
    },
];
