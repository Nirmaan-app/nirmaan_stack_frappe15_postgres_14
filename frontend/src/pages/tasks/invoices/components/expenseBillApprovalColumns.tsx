/**
 * Columns of Pending Approval -> Cashbook / Credit Card (#1644): one row per Expense bill waiting for a person, with
 * what the approver decides on -- spend date, line amount, bill total read, Bill check, invoice number and date, who
 * paid, project, who attached it and the bill file -- then Approve and Reject.
 *
 * Every column sets `size`: the shared table is `table-fixed` and gives an unsized column 150px.
 */
import { ColumnDef } from "@tanstack/react-table";

import { TruncatedText } from "@/components/common/TruncatedText";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Button } from "@/components/ui/button";
import SITEURL from "@/constants/siteURL";
import { formatDate } from "@/utils/FormatDate";
import { formatForReport, formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { dateFilterFn, facetedFilterFn } from "@/utils/tableFilters";

import { type PendingExpenseBillRow, billCheckText, readTotalText } from "../utils/expenseBillApprovalView";

interface ExpenseBillApprovalColumnOptions {
    onApprove: (row: PendingExpenseBillRow) => void;
    onReject: (row: PendingExpenseBillRow) => void;
}

const money = (value: number | null) => (
    <div className="text-right whitespace-nowrap tabular-nums">{value === null ? "--" : formatToRoundedIndianRupee(value)}</div>
);

export const getExpenseBillApprovalColumns = ({
    onApprove, onReject,
}: ExpenseBillApprovalColumnOptions): ColumnDef<PendingExpenseBillRow>[] => [
    {
        accessorKey: "payment_date",
        size: 115,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Spend date" />,
        cell: ({ row }) => <div className="whitespace-nowrap">{formatDate(row.original.payment_date)}</div>,
        filterFn: dateFilterFn,
        enableGlobalFilter: false,
        meta: { exportHeaderName: "Spend date", exportValue: (row: PendingExpenseBillRow) => formatDate(row.payment_date) },
    },
    {
        accessorKey: "line_amount",
        size: 115,
        header: ({ column }) => (
            <div className="w-full flex justify-end"><DataTableColumnHeader column={column} title="Line amount" /></div>
        ),
        cell: ({ row }) => money(row.original.line_amount),
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
        cell: ({ row }) => <div className="text-right whitespace-nowrap tabular-nums">{readTotalText(row.original)}</div>,
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
        size: 200,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Bill check" />,
        cell: ({ row }) => (
            <div>
                <div className="font-medium">{row.original.bill_check}</div>
                {row.original.bill_check_reason && (
                    <TruncatedText text={row.original.bill_check_reason} className="max-w-full text-xs text-muted-foreground" />
                )}
            </div>
        ),
        filterFn: facetedFilterFn,
        meta: { exportHeaderName: "Bill check", exportValue: (row: PendingExpenseBillRow) => billCheckText(row) },
    },
    {
        id: "invoice",
        size: 140,
        accessorFn: (row) => row.invoice_no ?? "",
        header: "Invoice no. / date",
        cell: ({ row }) => (
            <div className="whitespace-nowrap">
                <div>{row.original.invoice_no || "--"}</div>
                <div className="text-xs text-muted-foreground">{row.original.invoice_date ? formatDate(row.original.invoice_date) : "--"}</div>
            </div>
        ),
        enableSorting: false,
        meta: {
            exportHeaderName: "Invoice no. / date",
            exportValue: (row: PendingExpenseBillRow) =>
                [row.invoice_no ?? "", row.invoice_date ? formatDate(row.invoice_date) : ""].filter(Boolean).join(" / "),
        },
    },
    {
        id: "paid_by",
        size: 140,
        accessorFn: (row) => row.paid_by ?? "",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Paid by" />,
        cell: ({ row }) => <TruncatedText text={row.original.paid_by || "--"} className="max-w-full" />,
        filterFn: facetedFilterFn,
        meta: { exportHeaderName: "Paid by", exportValue: (row: PendingExpenseBillRow) => row.paid_by ?? "" },
    },
    {
        // Blank for a Non-Project spend.
        id: "project",
        size: 160,
        accessorFn: (row) => row.project_name || row.project || "",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
        cell: ({ row }) => <TruncatedText text={row.original.project_name || row.original.project || ""} className="max-w-full" />,
        filterFn: facetedFilterFn,
        meta: { exportHeaderName: "Project", exportValue: (row: PendingExpenseBillRow) => row.project_name || row.project || "" },
    },
    {
        id: "uploaded_by",
        size: 150,
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
        size: 80,
        header: "Bill",
        cell: ({ row }) => (
            <a
                href={`${SITEURL}${row.original.bill_file}`}
                target="_blank"
                rel="noreferrer"
                className="text-blue-600 hover:underline"
            >
                View
            </a>
        ),
        enableSorting: false,
        enableGlobalFilter: false,
        meta: { exportHeaderName: "Bill", exportValue: (row: PendingExpenseBillRow) => row.bill_file },
    },
    {
        id: "actions",
        size: 190,
        header: () => <div className="text-right">Actions</div>,
        cell: ({ row }) => (
            <div className="flex justify-end gap-2 whitespace-nowrap">
                <Button size="sm" variant="outline" onClick={() => onApprove(row.original)}>Approve</Button>
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => onReject(row.original)}>Reject</Button>
            </div>
        ),
        enableSorting: false,
        enableGlobalFilter: false,
        meta: { excludeFromExport: true },
    },
];
