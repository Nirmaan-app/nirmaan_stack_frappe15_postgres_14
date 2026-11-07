/**
 * Columns of All Invoices -> Cashbook / Credit Card and -> Porter (#1646, spec #1637). Server-mode tables: each
 * column id is the list endpoint's field it sorts and filters by.
 *
 * Every column sets `size`: the shared table is `table-fixed` and gives an unsized column 150px.
 */
import type { ColumnDef, HeaderContext } from "@tanstack/react-table";

import { TruncatedText } from "@/components/common/TruncatedText";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import SITEURL from "@/constants/siteURL";
import { formatDate } from "@/utils/FormatDate";
import { formatForReport, formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import {
    type AllExpenseBillRow, type PorterInvoiceListRow, approvalText, billDecision, porterResultText,
} from "../utils/allInvoicesView";
import { billCheckText, readTotalText } from "../utils/expenseBillApprovalView";

const money = (value: number | null) => (
    <div className="text-right whitespace-nowrap tabular-nums">{value === null || value === undefined ? "--" : formatToRoundedIndianRupee(value)}</div>
);

const fileLink = (file: string | null, label = "View") =>
    file ? (
        <a href={`${SITEURL}${file}`} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">{label}</a>
    ) : (
        <span className="text-muted-foreground">--</span>
    );

const rightHeader = <TRow,>(title: string) => ({ column }: HeaderContext<TRow, unknown>) => (
    <div className="w-full flex justify-end"><DataTableColumnHeader column={column} title={title} /></div>
);

interface AllExpenseBillColumnOptions {
    /** A user's full name from their id; the list ships ids for who decided. */
    userName: (id: string) => string;
}

const decisionText = (row: AllExpenseBillRow, userName: (id: string) => string): string => {
    const decided = billDecision(row);
    return decided ? `${userName(decided.by)}, ${formatDate(decided.on)}` : "";
};

export const getAllExpenseBillColumns = ({ userName }: AllExpenseBillColumnOptions): ColumnDef<AllExpenseBillRow>[] => [
    {
        accessorKey: "payment_date",
        size: 120,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Spend date" />,
        cell: ({ row }) => <div className="whitespace-nowrap">{formatDate(row.original.payment_date)}</div>,
        meta: { exportHeaderName: "Spend date", exportValue: (row: AllExpenseBillRow) => formatDate(row.payment_date) },
    },
    {
        accessorKey: "expense",
        size: 140,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Expense" />,
        cell: ({ row }) => <TruncatedText text={row.original.expense} className="max-w-full" />,
        meta: { exportHeaderName: "Expense" },
    },
    {
        accessorKey: "line_amount",
        size: 120,
        header: rightHeader<AllExpenseBillRow>("Line amount"),
        cell: ({ row }) => money(row.original.line_amount),
        meta: { exportHeaderName: "Line amount", exportValue: (row: AllExpenseBillRow) => formatForReport(row.line_amount), isNumeric: true },
    },
    {
        accessorKey: "read_total",
        size: 120,
        header: rightHeader<AllExpenseBillRow>("Bill total read"),
        cell: ({ row }) => <div className="text-right whitespace-nowrap tabular-nums">{readTotalText(row.original)}</div>,
        meta: {
            exportHeaderName: "Bill total read",
            exportValue: (row: AllExpenseBillRow) => (row.read_total === null ? "" : formatForReport(row.read_total)),
            isNumeric: true,
        },
    },
    {
        accessorKey: "invoice_no",
        size: 140,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Invoice no. / date" />,
        cell: ({ row }) => (
            <div className="whitespace-nowrap">
                <TruncatedText text={row.original.invoice_no || "--"} className="max-w-full" />
                <div className="text-xs text-muted-foreground">{row.original.invoice_date ? formatDate(row.original.invoice_date) : "--"}</div>
            </div>
        ),
        meta: {
            exportHeaderName: "Invoice no. / date",
            exportValue: (row: AllExpenseBillRow) =>
                [row.invoice_no ?? "", row.invoice_date ? formatDate(row.invoice_date) : ""].filter(Boolean).join(" / "),
        },
    },
    {
        accessorKey: "bill_check",
        size: 170,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Bill check" />,
        cell: ({ row }) => (
            <div>
                <div className="font-medium">{row.original.bill_check}</div>
                {row.original.bill_check_reason && (
                    <TruncatedText text={row.original.bill_check_reason} className="max-w-full text-xs text-muted-foreground" />
                )}
            </div>
        ),
        meta: { exportHeaderName: "Bill check", exportValue: (row: AllExpenseBillRow) => billCheckText(row) },
    },
    {
        accessorKey: "approval",
        size: 150,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Approval" />,
        cell: ({ row }) => (
            <div>
                <div className="font-medium">{row.original.approval}</div>
                {row.original.approval === "Rejected" && row.original.rejection_reason && (
                    <TruncatedText text={row.original.rejection_reason} className="max-w-full text-xs text-muted-foreground" />
                )}
            </div>
        ),
        meta: { exportHeaderName: "Approval", exportValue: (row: AllExpenseBillRow) => approvalText(row) },
    },
    {
        id: "decided",
        size: 150,
        header: "Decided by / on",
        cell: ({ row }) => {
            const decided = billDecision(row.original);
            return decided ? (
                <div>
                    <TruncatedText text={userName(decided.by)} className="max-w-full" />
                    <div className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(decided.on)}</div>
                </div>
            ) : null;
        },
        enableSorting: false,
        meta: { exportHeaderName: "Decided by / on", exportValue: (row: AllExpenseBillRow) => decisionText(row, userName) },
    },
    {
        // A bill a newer one replaced is history; the Expense's latest bill is the one that counts.
        id: "is_latest",
        accessorFn: (row) => String(row.is_latest),
        size: 95,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Bill" />,
        cell: ({ row }) => (row.original.is_latest ? "Latest" : <span className="text-muted-foreground">Replaced</span>),
        enableSorting: false,
        meta: { exportHeaderName: "Bill", exportValue: (row: AllExpenseBillRow) => (row.is_latest ? "Latest" : "Replaced") },
    },
    {
        accessorKey: "paid_by",
        size: 130,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Paid by" />,
        cell: ({ row }) => <TruncatedText text={row.original.paid_by || "--"} className="max-w-full" />,
        meta: { exportHeaderName: "Paid by", exportValue: (row: AllExpenseBillRow) => row.paid_by ?? "" },
    },
    {
        // Blank for a Non-Project spend.
        accessorKey: "project_name",
        size: 140,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
        cell: ({ row }) => <TruncatedText text={row.original.project_name || row.original.project || ""} className="max-w-full" />,
        meta: { exportHeaderName: "Project", exportValue: (row: AllExpenseBillRow) => row.project_name || row.project || "" },
    },
    {
        accessorKey: "uploaded_by_name",
        size: 140,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Invoice Added By" />,
        cell: ({ row }) => <TruncatedText text={row.original.uploaded_by_name || row.original.uploaded_by || "--"} className="max-w-full font-medium" />,
        meta: { exportHeaderName: "Invoice Added By", exportValue: (row: AllExpenseBillRow) => row.uploaded_by_name || row.uploaded_by || "" },
    },
    {
        accessorKey: "creation",
        size: 115,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Attached on" />,
        cell: ({ row }) => <div className="whitespace-nowrap">{formatDate(row.original.creation)}</div>,
        meta: { exportHeaderName: "Attached on", exportValue: (row: AllExpenseBillRow) => formatDate(row.creation) },
    },
    {
        id: "bill_file",
        size: 65,
        header: "File",
        cell: ({ row }) => fileLink(row.original.bill_file),
        enableSorting: false,
        meta: { exportHeaderName: "File", exportValue: (row: AllExpenseBillRow) => row.bill_file },
    },
];

export const getPorterInvoiceColumns = (): ColumnDef<PorterInvoiceListRow>[] => [
    {
        accessorKey: "name",
        size: 160,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Invoice no." />,
        cell: ({ row }) => <TruncatedText text={row.original.name} className="max-w-full font-medium" />,
        meta: { exportHeaderName: "Invoice no." },
    },
    {
        accessorKey: "read_invoice_date",
        size: 120,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Invoice date" />,
        cell: ({ row }) => <div className="whitespace-nowrap">{row.original.read_invoice_date ? formatDate(row.original.read_invoice_date) : "--"}</div>,
        meta: {
            exportHeaderName: "Invoice date",
            exportValue: (row: PorterInvoiceListRow) => (row.read_invoice_date ? formatDate(row.read_invoice_date) : ""),
        },
    },
    {
        accessorKey: "validation_status",
        size: 220,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Validate result" />,
        cell: ({ row }) => (
            <div>
                <div className="font-medium">{row.original.validation_status || "--"}</div>
                {row.original.validation_message && (
                    <TruncatedText text={row.original.validation_message} className="max-w-full text-xs text-muted-foreground" />
                )}
            </div>
        ),
        meta: { exportHeaderName: "Validate result", exportValue: (row: PorterInvoiceListRow) => porterResultText(row) },
    },
    {
        accessorKey: "city",
        size: 110,
        header: ({ column }) => <DataTableColumnHeader column={column} title="City" />,
        cell: ({ row }) => <TruncatedText text={row.original.city || "--"} className="max-w-full" />,
        meta: { exportHeaderName: "City" },
    },
    {
        accessorKey: "completed_orders",
        size: 90,
        header: rightHeader<PorterInvoiceListRow>("Trips"),
        cell: ({ row }) => <div className="text-right tabular-nums">{row.original.completed_orders ?? "--"}</div>,
        meta: { exportHeaderName: "Trips", isNumeric: true },
    },
    {
        accessorKey: "invoice_total",
        size: 130,
        header: rightHeader<PorterInvoiceListRow>("Total (incl. GST)"),
        cell: ({ row }) => money(row.original.invoice_total),
        meta: {
            exportHeaderName: "Total (incl. GST)",
            exportValue: (row: PorterInvoiceListRow) => formatForReport(row.invoice_total),
            isNumeric: true,
        },
    },
    {
        accessorKey: "import_batch",
        size: 150,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Import" />,
        cell: ({ row }) => <TruncatedText text={row.original.import_batch || "--"} className="max-w-full" />,
        meta: { exportHeaderName: "Import" },
    },
    {
        accessorKey: "creation",
        size: 115,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Imported on" />,
        cell: ({ row }) => <div className="whitespace-nowrap">{formatDate(row.original.creation)}</div>,
        meta: { exportHeaderName: "Imported on", exportValue: (row: PorterInvoiceListRow) => formatDate(row.creation) },
    },
    {
        id: "invoice_file",
        size: 65,
        header: "PDF",
        cell: ({ row }) => fileLink(row.original.invoice_file, "Open"),
        enableSorting: false,
        meta: { exportHeaderName: "PDF", exportValue: (row: PorterInvoiceListRow) => row.invoice_file ?? "" },
    },
];
