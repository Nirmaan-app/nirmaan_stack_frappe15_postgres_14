/**
 * Columns of Pending Approval -> Cashbook / Credit Card (#1644): one row per Expense bill waiting for a person, with
 * what the approver decides on -- spend date, line amount, bill total read, Bill check, invoice number and date, who
 * paid, project, who attached it and the bill file -- then Approve and Reject, and Read again on a Not read bill
 * for whoever may read it again (#1645).
 *
 * Every column sets `size`: the shared table is `table-fixed` and gives an unsized column 150px.
 */
import { ColumnDef } from "@tanstack/react-table";

import { TruncatedText } from "@/components/common/TruncatedText";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/utils/FormatDate";
import { formatForReport } from "@/utils/FormatPrice";
import { dateFilterFn, facetedFilterFn } from "@/utils/tableFilters";

import { type PendingExpenseBillRow, billCheckText } from "../utils/expenseBillApprovalView";
import {
    BillCheckResultCell, FileLinkCell, InvoiceNoDateCell, MoneyCell, invoiceNoDateText, rightAlignedHeader,
} from "./ExpenseBillCells";

interface ExpenseBillApprovalColumnOptions {
    onApprove: (row: PendingExpenseBillRow) => void;
    onReject: (row: PendingExpenseBillRow) => void;
    onReadAgain: (row: PendingExpenseBillRow) => void;
    /** Admin and Accountant Lead (`canReadExpenseBillAgain`); the server checks it too. */
    canReadAgain: boolean;
    /** The bill whose Read again is being sent, if any. */
    readingAgainBill?: string | null;
}

export const getExpenseBillApprovalColumns = ({
    onApprove, onReject, onReadAgain, canReadAgain, readingAgainBill = null,
}: ExpenseBillApprovalColumnOptions): ColumnDef<PendingExpenseBillRow>[] => [
    {
        accessorKey: "payment_date",
        size: 130,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Spend date" />,
        cell: ({ row }) => <div className="whitespace-nowrap">{formatDate(row.original.payment_date)}</div>,
        filterFn: dateFilterFn,
        enableGlobalFilter: false,
        meta: { exportHeaderName: "Spend date", exportValue: (row: PendingExpenseBillRow) => formatDate(row.payment_date) },
    },
    {
        accessorKey: "line_amount",
        size: 125,
        header: rightAlignedHeader<PendingExpenseBillRow>("Line amount"),
        cell: ({ row }) => <MoneyCell value={row.original.line_amount} />,
        enableGlobalFilter: false,
        meta: {
            exportHeaderName: "Line amount",
            exportValue: (row: PendingExpenseBillRow) => formatForReport(row.line_amount),
            isNumeric: true,
        },
    },
    {
        accessorKey: "read_total",
        size: 115,
        header: () => <div className="text-right">Bill total read</div>,
        cell: ({ row }) => <MoneyCell value={row.original.read_total} />,
        enableSorting: false,
        enableGlobalFilter: false,
        meta: {
            exportHeaderName: "Bill total read",
            exportValue: (row: PendingExpenseBillRow) => (row.read_total === null ? "" : formatForReport(row.read_total)),
            isNumeric: true,
        },
    },
    {
        accessorKey: "bill_check",
        size: 180,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Bill check" />,
        cell: ({ row }) => <BillCheckResultCell row={row.original} />,
        filterFn: facetedFilterFn,
        meta: { exportHeaderName: "Bill check", exportValue: (row: PendingExpenseBillRow) => billCheckText(row) },
    },
    {
        id: "invoice",
        size: 140,
        accessorFn: (row) => row.invoice_no ?? "",
        header: "Invoice no. / date",
        cell: ({ row }) => <InvoiceNoDateCell row={row.original} />,
        enableSorting: false,
        meta: { exportHeaderName: "Invoice no. / date", exportValue: invoiceNoDateText },
    },
    {
        id: "paid_by",
        size: 130,
        accessorFn: (row) => row.paid_by ?? "",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Paid by" />,
        cell: ({ row }) => <TruncatedText text={row.original.paid_by || "--"} className="max-w-full" />,
        filterFn: facetedFilterFn,
        meta: { exportHeaderName: "Paid by", exportValue: (row: PendingExpenseBillRow) => row.paid_by ?? "" },
    },
    {
        // Blank for a Non-Project spend.
        id: "project",
        size: 140,
        accessorFn: (row) => row.project_name || row.project || "",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
        cell: ({ row }) => <TruncatedText text={row.original.project_name || row.original.project || ""} className="max-w-full" />,
        filterFn: facetedFilterFn,
        meta: { exportHeaderName: "Project", exportValue: (row: PendingExpenseBillRow) => row.project_name || row.project || "" },
    },
    {
        id: "uploaded_by",
        size: 140,
        accessorFn: (row) => row.uploaded_by_name || row.uploaded_by || "",
        header: "Invoice Added By",
        cell: ({ row }) => <TruncatedText text={row.original.uploaded_by_name || row.original.uploaded_by || "--"} className="max-w-full font-medium" />,
        enableSorting: false,
        meta: {
            exportHeaderName: "Invoice Added By",
            exportValue: (row: PendingExpenseBillRow) => row.uploaded_by_name || row.uploaded_by || "",
        },
    },
    {
        id: "bill_file",
        size: 70,
        header: "Bill",
        cell: ({ row }) => <FileLinkCell file={row.original.bill_file} />,
        enableSorting: false,
        enableGlobalFilter: false,
        meta: { exportHeaderName: "Bill", exportValue: (row: PendingExpenseBillRow) => row.bill_file },
    },
    {
        id: "actions",
        size: 260,
        header: () => <div className="text-right">Actions</div>,
        cell: ({ row }) => (
            <div className="flex justify-end gap-2 whitespace-nowrap">
                {canReadAgain && row.original.bill_check === "Not read" && (
                    <Button
                        size="sm"
                        variant="secondary"
                        disabled={readingAgainBill === row.original.name}
                        onClick={() => onReadAgain(row.original)}
                    >
                        Read again
                    </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => onApprove(row.original)}>Approve</Button>
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => onReject(row.original)}>Reject</Button>
            </div>
        ),
        enableSorting: false,
        enableGlobalFilter: false,
        meta: { excludeFromExport: true },
    },
];
