import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { Download, Info } from "lucide-react";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { FacetDeclaration } from "@/components/data-table/facetConfig";
import { Badge } from "@/components/ui/badge";
import { TruncatedText } from "@/components/common/TruncatedText";
import SITEURL from "@/constants/siteURL";
import { OrderDetailLink } from "@/pages/ProjectPayments/components/OrderDetailLink";
import { ReconciliationPendingBadge } from "@/pages/ProjectPayments/components/ReconciliationPendingBadge";
import { formatDate } from "@/utils/FormatDate";
import { formatForReport, formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { CHEQUE_VALIDITY_DAYS, daysOutstanding } from "../../config/chequePaymentTable.config";
import { ChequeExtras, ChequePaymentRow } from "../../utils/chequePaymentExtras";

interface ChequePaymentColumnArgs {
    /** The row's PO / WO figures, TDS and cheque count; undefined until loaded. */
    extrasOf: (row: ChequePaymentRow) => ChequeExtras | undefined;
    userName: (id?: string) => string;
}

/** Lets a sortable header's title break onto a second line, so columns stay narrow enough to
 *  fit the screen without a horizontal scrollbar. */
const WRAP_HEADER = "[&_button]:whitespace-normal text-left";

const dateText = (v?: string) => (v ? formatDate(v) : "");
const money = (v: number | undefined) => (v === undefined ? "--" : formatToRoundedIndianRupee(v));
const exportMoney = (v: number | undefined) => (v === undefined ? "" : formatForReport(v));

const DateCell = ({ value }: { value?: string }) => (
    <div className="whitespace-nowrap">{value ? formatDate(value) : "--"}</div>
);

const MoneyCell = ({ value, strong }: { value: number | undefined; strong?: boolean }) => (
    <div className={`whitespace-nowrap ${strong ? "font-medium" : ""}`}>{money(value)}</div>
);

/** Name + an info icon that opens the record (same pattern as the other report tables). */
const LinkedName = ({ text, to, title }: { text: string; to: string; title: string }) => (
    <div className="flex items-center gap-1 min-w-0">
        <TruncatedText text={text} fallback="--" className="max-w-full" />
        <Link to={to} title={title} className="shrink-0">
            <Info className="text-blue-500 h-3 w-3" />
        </Link>
    </div>
);

/** Same colours as the PO page's payment table. */
const PaymentStatusBadge = ({ status }: { status: string }) => {
    switch (status) {
        case "Requested":
            return <Badge variant="outline" className="border-orange-500 text-orange-600">Requested</Badge>;
        case "CEO Pending":
            return <Badge variant="outline" className="border-blue-500 text-blue-600">CEO Pending</Badge>;
        case "Approved":
            return <Badge variant="outline" className="border-amber-500 text-amber-600">Approved</Badge>;
        case "Reconciliation Pending":
            return <ReconciliationPendingBadge />;
        case "Paid":
            return <Badge variant="green">Paid</Badge>;
        case "Rejected":
            return <Badge variant="outline" className="border-red-500 text-red-600">Rejected</Badge>;
        default:
            return <Badge variant="outline">{status || "--"}</Badge>;
    }
};

/** Gross is only meaningful where TDS was withheld (a WO); a PO payment has nothing to add back. */
const grossOf = (row: ChequePaymentRow, extras?: ChequeExtras) =>
    extras && extras.tds > 0 ? Number(row.amount || 0) + extras.tds : undefined;

const approvedOn = (row: ChequePaymentRow) => row.ceo_approval_date || row.approval_date || "";

const balanceOf = (extras?: ChequeExtras) =>
    extras?.order ? extras.order.total_amount - extras.order.amount_paid : undefined;

export const getChequePaymentColumns = ({
    extrasOf,
    userName,
}: ChequePaymentColumnArgs): ColumnDef<ChequePaymentRow>[] => [
    // ---- Cheque ----
    {
        accessorKey: "cheque_no",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Cheque No" className={WRAP_HEADER} />,
        cell: ({ row }) => <div className="font-medium whitespace-nowrap">{row.original.cheque_no || "--"}</div>,
        size: 95,
        meta: { exportHeaderName: "Cheque No", exportValue: (r: ChequePaymentRow) => r.cheque_no || "" },
    },
    {
        accessorKey: "cheque_date",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Cheque Date" className={WRAP_HEADER} />,
        cell: ({ row }) => <DateCell value={row.original.cheque_date} />,
        size: 120,
        meta: { exportHeaderName: "Cheque Date", exportValue: (r: ChequePaymentRow) => dateText(r.cheque_date) },
    },
    {
        id: "cheque_payment_count",
        accessorFn: (r) => extrasOf(r)?.chequePaymentCount,
        header: "Payments on this cheque",
        cell: ({ row }) => {
            const n = extrasOf(row.original)?.chequePaymentCount;
            if (!n || row.original.status === "Rejected") return <span>--</span>;
            return <span className={n > 1 ? "font-medium text-blue-700" : ""}>{n}</span>;
        },
        size: 95,
        enableSorting: false,
        meta: {
            exportHeaderName: "Payments on this cheque",
            exportValue: (r: ChequePaymentRow) => {
                const n = extrasOf(r)?.chequePaymentCount;
                return n && r.status !== "Rejected" ? String(n) : "";
            },
        },
    },
    {
        id: "days_outstanding",
        accessorFn: (r) => daysOutstanding(r),
        header: "Days outstanding",
        cell: ({ row }) => {
            const days = daysOutstanding(row.original);
            if (days === null) return <span>--</span>;
            const stale = days > CHEQUE_VALIDITY_DAYS;
            return (
                <span
                    className={stale ? "font-medium text-red-600" : ""}
                    title={stale ? "A cheque is only valid for 3 months from its date" : undefined}
                >
                    {days}
                </span>
            );
        },
        size: 100,
        enableSorting: false,
        meta: {
            exportHeaderName: "Days outstanding",
            exportValue: (r: ChequePaymentRow) => {
                const days = daysOutstanding(r);
                return days === null ? "" : String(days);
            },
        },
    },
    // ---- Payment ----
    {
        accessorKey: "name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Payment ID" className={WRAP_HEADER} />,
        cell: ({ row }) => <div className="whitespace-nowrap">{row.original.name}</div>,
        size: 115,
        meta: { exportHeaderName: "Payment ID", exportValue: (r: ChequePaymentRow) => r.name },
    },
    {
        accessorKey: "status",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" className={WRAP_HEADER} />,
        cell: ({ row }) => <PaymentStatusBadge status={row.original.status} />,
        size: 120,
        meta: {
            exportHeaderName: "Status",
            exportValue: (r: ChequePaymentRow) => r.status || "",
            facet: { field: "status", title: "Status" } satisfies FacetDeclaration,
        },
    },
    {
        accessorKey: "amount",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Cheque Amount" className={WRAP_HEADER} />,
        cell: ({ row }) => <MoneyCell value={Number(row.original.amount || 0)} strong />,
        size: 100,
        meta: {
            isNumeric: true,
            exportHeaderName: "Cheque Amount",
            exportValue: (r: ChequePaymentRow) => formatForReport(r.amount),
        },
    },
    {
        id: "tds",
        accessorFn: (r) => extrasOf(r)?.tds,
        header: "TDS",
        cell: ({ row }) => {
            const tds = extrasOf(row.original)?.tds;
            return <div className="whitespace-nowrap">{tds ? formatToRoundedIndianRupee(tds) : "--"}</div>;
        },
        size: 75,
        enableSorting: false,
        meta: {
            isNumeric: true,
            exportHeaderName: "TDS",
            exportValue: (r: ChequePaymentRow) => {
                const tds = extrasOf(r)?.tds;
                return tds ? formatForReport(tds) : "";
            },
        },
    },
    {
        id: "gross",
        accessorFn: (r) => grossOf(r, extrasOf(r)),
        header: "Gross",
        cell: ({ row }) => <MoneyCell value={grossOf(row.original, extrasOf(row.original))} />,
        size: 90,
        enableSorting: false,
        meta: {
            isNumeric: true,
            exportHeaderName: "Gross",
            exportValue: (r: ChequePaymentRow) => exportMoney(grossOf(r, extrasOf(r))),
        },
    },
    {
        id: "approved_on",
        accessorFn: (r) => approvedOn(r),
        header: "Approved On",
        cell: ({ row }) => <DateCell value={approvedOn(row.original)} />,
        size: 100,
        enableSorting: false,
        meta: { exportHeaderName: "Approved On", exportValue: (r: ChequePaymentRow) => dateText(approvedOn(r)) },
    },
    {
        accessorKey: "payment_date",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Payment Date" className={WRAP_HEADER} />,
        cell: ({ row }) => <DateCell value={row.original.payment_date} />,
        size: 130,
        meta: { exportHeaderName: "Payment Date", exportValue: (r: ChequePaymentRow) => dateText(r.payment_date) },
    },
    {
        accessorKey: "utr",
        header: ({ column }) => <DataTableColumnHeader column={column} title="UTR / Ref" className={WRAP_HEADER} />,
        cell: ({ row }) => <TruncatedText text={row.original.utr} fallback="--" className="max-w-full" />,
        size: 120,
        meta: { exportHeaderName: "UTR / Ref", exportValue: (r: ChequePaymentRow) => r.utr || "" },
    },
    {
        accessorKey: "on_hold",
        header: ({ column }) => <DataTableColumnHeader column={column} title="On Hold" className={WRAP_HEADER} />,
        cell: ({ row }) =>
            Number(row.original.on_hold) === 1 ? (
                <Badge variant="outline" className="border-amber-500 text-amber-700">On hold</Badge>
            ) : (
                <span>--</span>
            ),
        size: 85,
        meta: {
            exportHeaderName: "On Hold",
            exportValue: (r: ChequePaymentRow) => (Number(r.on_hold) === 1 ? "Yes" : ""),
        },
    },
    {
        accessorKey: "payment_attachment",
        header: "Attachment",
        cell: ({ row }) => {
            const url = row.original.payment_attachment;
            return url ? (
                <a
                    href={SITEURL + url}
                    target="_blank"
                    rel="noreferrer"
                    title="Payment attachment"
                    className="inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-700 hover:underline"
                >
                    <Download className="h-3.5 w-3.5" /> View
                </a>
            ) : (
                <span className="text-xs text-muted-foreground">--</span>
            );
        },
        size: 95,
        enableSorting: false,
        meta: { exportHeaderName: "Attachment", excludeFromExport: true },
    },
    // ---- PO / WO ----
    {
        accessorKey: "document_name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="PO / WO No" className={WRAP_HEADER} />,
        cell: ({ row }) => {
            const doc = row.original.document_name;
            if (!doc) return <span>--</span>;
            return (
                <div className="flex items-center gap-1 min-w-0">
                    <span className="break-all">{doc}</span>
                    <OrderDetailLink docName={doc} title="Open PO / WO">
                        <Info className="text-blue-500 h-3 w-3" />
                    </OrderDetailLink>
                </div>
            );
        },
        size: 160,
        meta: { exportHeaderName: "PO / WO No", exportValue: (r: ChequePaymentRow) => r.document_name || "" },
    },
    {
        id: "order_total",
        accessorFn: (r) => extrasOf(r)?.order?.total_amount,
        header: "PO/WO Total (incl. GST)",
        cell: ({ row }) => <MoneyCell value={extrasOf(row.original)?.order?.total_amount} />,
        size: 105,
        enableSorting: false,
        meta: {
            isNumeric: true,
            exportHeaderName: "PO/WO Total (incl. GST)",
            exportValue: (r: ChequePaymentRow) => exportMoney(extrasOf(r)?.order?.total_amount),
        },
    },
    {
        accessorKey: "project",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Project" className={WRAP_HEADER} />,
        cell: ({ row }) => (
            <LinkedName
                text={row.original.project_name || row.original.project}
                to={`/projects/${row.original.project}`}
                title="Open Project"
            />
        ),
        size: 160,
        meta: {
            exportHeaderName: "Project",
            exportValue: (r: ChequePaymentRow) => r.project_name || r.project || "",
            facet: { field: "project", title: "Project" } satisfies FacetDeclaration,
        },
    },
    {
        accessorKey: "vendor",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Vendor" className={WRAP_HEADER} />,
        cell: ({ row }) => {
            const v = row.original.vendor || "";
            if (!v) return <span>--</span>;
            return <LinkedName text={row.original.vendor_name || v} to={`/vendors/${v}`} title="Open Vendor" />;
        },
        size: 160,
        meta: {
            exportHeaderName: "Vendor",
            exportValue: (r: ChequePaymentRow) => r.vendor_name || r.vendor || "",
            facet: { field: "vendor", title: "Vendor" } satisfies FacetDeclaration,
        },
    },
    {
        id: "order_status",
        accessorFn: (r) => extrasOf(r)?.order?.status,
        header: "PO/WO Status",
        cell: ({ row }) => <span className="whitespace-nowrap">{extrasOf(row.original)?.order?.status || "--"}</span>,
        size: 100,
        enableSorting: false,
        meta: {
            exportHeaderName: "PO/WO Status",
            exportValue: (r: ChequePaymentRow) => extrasOf(r)?.order?.status || "",
        },
    },
    {
        id: "order_amount_paid",
        accessorFn: (r) => extrasOf(r)?.order?.amount_paid,
        header: "Total Paid",
        cell: ({ row }) => <MoneyCell value={extrasOf(row.original)?.order?.amount_paid} />,
        size: 100,
        enableSorting: false,
        meta: {
            isNumeric: true,
            exportHeaderName: "Total Paid",
            exportValue: (r: ChequePaymentRow) => exportMoney(extrasOf(r)?.order?.amount_paid),
        },
    },
    {
        id: "order_amount_invoiced",
        accessorFn: (r) => extrasOf(r)?.order?.amount_invoiced,
        header: "Invoiced",
        cell: ({ row }) => <MoneyCell value={extrasOf(row.original)?.order?.amount_invoiced} />,
        size: 100,
        enableSorting: false,
        meta: {
            isNumeric: true,
            exportHeaderName: "Invoiced",
            exportValue: (r: ChequePaymentRow) => exportMoney(extrasOf(r)?.order?.amount_invoiced),
        },
    },
    {
        id: "order_balance",
        accessorFn: (r) => balanceOf(extrasOf(r)),
        header: "Balance",
        // Total - Paid on both PO and WO. NOT the stored `amount_due`: that is invoiced - paid on a
        // PO but total - paid on a WO, so one column would mix two different figures.
        cell: ({ row }) => <MoneyCell value={balanceOf(extrasOf(row.original))} />,
        size: 100,
        enableSorting: false,
        meta: {
            isNumeric: true,
            exportHeaderName: "Balance (Total - Paid)",
            exportValue: (r: ChequePaymentRow) => exportMoney(balanceOf(extrasOf(r))),
        },
    },
    {
        accessorKey: "creation",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Requested On" className={WRAP_HEADER} />,
        cell: ({ row }) => <DateCell value={row.original.creation} />,
        size: 145,
        meta: { exportHeaderName: "Requested On", exportValue: (r: ChequePaymentRow) => dateText(r.creation) },
    },
    {
        accessorKey: "owner",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Requested By" className={WRAP_HEADER} />,
        cell: ({ row }) => <TruncatedText text={userName(row.original.owner)} fallback="--" className="max-w-full" />,
        size: 125,
        meta: { exportHeaderName: "Requested By", exportValue: (r: ChequePaymentRow) => userName(r.owner) },
    },
];
