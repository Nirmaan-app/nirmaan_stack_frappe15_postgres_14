/**
 * Columns of the Pending Invoices Upload -> Credit Card table.
 *
 * Search covers Transaction details, Expense Type, Holder and Statement only (`enableGlobalFilter` off
 * elsewhere), so a typed amount or date never matches by accident. Expense Type, Holder and Statement carry column filters,
 * Date a date-range filter, Date and Amount sort. Export reads each column's `meta`.
 *
 * Every column sets `size`: the shared table is `table-fixed` and gives an unsized column 150px, which cut
 * the Statement cell and pushed the two action buttons past the edge. Sizes wider than the screen scroll.
 */
import { ColumnDef } from "@tanstack/react-table";

import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee, { formatForReport } from "@/utils/FormatPrice";
import { dateFilterFn, facetedFilterFn } from "@/utils/tableFilters";

import { type CardInvoiceRow, expenseTypeLabel, statementLabel, statementMonthsLabel } from "../utils/cardInvoicesView";

interface CardInvoiceColumnOptions {
    /** Which row actions the user gets (`cardInvoiceActions`). */
    actions: { attach: boolean; noInvoice: boolean };
    onAttach: (name: string) => void;
    onNoInvoice: (name: string) => void;
}

export const getCardInvoiceColumns = ({
    actions, onAttach, onNoInvoice,
}: CardInvoiceColumnOptions): ColumnDef<CardInvoiceRow>[] => [
    {
        accessorKey: "payment_date",
        size: 115,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
        cell: ({ row }) => <div className="whitespace-nowrap">{formatDate(row.original.payment_date)}</div>,
        filterFn: dateFilterFn,
        enableGlobalFilter: false,
        meta: {
            exportHeaderName: "Date",
            exportValue: (row: CardInvoiceRow) => formatDate(row.payment_date),
        },
    },
    {
        // Merchant and the statement line together, so a search finds either.
        id: "transaction_details",
        size: 250,
        accessorFn: (row) => `${row.merchant} ${row.details}`,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Transaction details" />,
        cell: ({ row }) => (
            <div>
                <div className="font-medium">{row.original.merchant}</div>
                <div className="text-xs text-muted-foreground">{row.original.details}</div>
            </div>
        ),
        meta: {
            exportHeaderName: "Transaction details",
            exportValue: (row: CardInvoiceRow) => `${row.merchant} - ${row.details}`,
        },
    },
    {
        accessorKey: "amount",
        size: 115,
        // Right-aligned like the figures under it.
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
            exportValue: (row: CardInvoiceRow) => formatForReport(row.amount),
            isNumeric: true,
        },
    },
    {
        // The label the summary card groups by, so a filter pick and a card row always name the same set.
        id: "expense_type",
        size: 180,
        accessorFn: (row) => expenseTypeLabel(row),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Expense Type" />,
        cell: ({ row }) => <div>{expenseTypeLabel(row.original)}</div>,
        filterFn: facetedFilterFn,
        meta: {
            exportHeaderName: "Expense Type",
            exportValue: (row: CardInvoiceRow) => expenseTypeLabel(row),
        },
    },
    {
        accessorKey: "holder",
        size: 150,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Holder" />,
        cell: ({ row }) => <div className="whitespace-nowrap">{row.original.holder}</div>,
        filterFn: facetedFilterFn,
        meta: {
            exportHeaderName: "Holder",
            exportValue: (row: CardInvoiceRow) => row.holder,
        },
    },
    {
        id: "statement",
        size: 150,
        // Months and statement ID, the value the Statement filter picks by.
        accessorFn: (row) => statementLabel(row),
        header: "Statement",
        cell: ({ row }) => (
            <div className="whitespace-nowrap">
                <div>{statementMonthsLabel(row.original.statement_months)}</div>
                <div className="text-xs text-muted-foreground">{row.original.credit_card_statement}</div>
            </div>
        ),
        filterFn: facetedFilterFn,
        enableSorting: false,
        meta: {
            exportHeaderName: "Statement",
            exportValue: (row: CardInvoiceRow) =>
                `${statementMonthsLabel(row.statement_months)} (${row.credit_card_statement})`,
        },
    },
    {
        id: "actions",
        size: 230,
        header: () => <div className="text-right">Actions</div>,
        cell: ({ row }) => (
            <div className="flex justify-end gap-2 whitespace-nowrap">
                {actions.attach && (
                    <Button size="sm" variant="outline" onClick={() => onAttach(row.original.name)}>
                        Attach invoice
                    </Button>
                )}
                {actions.noInvoice && (
                    <Button size="sm" variant="ghost" onClick={() => onNoInvoice(row.original.name)}>
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
