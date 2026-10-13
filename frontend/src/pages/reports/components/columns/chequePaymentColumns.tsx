import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { Info } from "lucide-react";

import { ChequePhotoLink } from "@/components/cheques/ChequePhotoLink";
import { ChequeStatusBadge } from "@/components/cheques/ChequeStatusBadge";
import { TruncatedText } from "@/components/common/TruncatedText";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import SITEURL from "@/constants/siteURL";
import { formatDate } from "@/utils/FormatDate";
import { formatForReport, formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import { ChequeRow, payeeOf, statusChangeText } from "../../config/chequePaymentTable.config";

/** Lets a sortable header's title break onto a second line, so columns stay narrow. */
const WRAP_HEADER = "[&_button]:whitespace-normal text-left";

const dateText = (v?: string | null) => (v ? formatDate(v) : "");

/**
 * The Cheque Payments report's columns (spec #1407): one row per Cheque. Actions (status change,
 * edit, detail) arrive with #1412 / #1418; the expandable lines with #1417.
 */
export const getChequePaymentColumns = (): ColumnDef<ChequeRow>[] => [
    {
        accessorKey: "cheque_no",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Cheque No" className={WRAP_HEADER} />,
        cell: ({ row }) => <div className="font-medium whitespace-nowrap">{row.original.cheque_no}</div>,
        size: 100,
        meta: { exportHeaderName: "Cheque No", exportValue: (r: ChequeRow) => r.cheque_no },
    },
    {
        accessorKey: "bank_label",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Bank" className={WRAP_HEADER} />,
        cell: ({ row }) => <TruncatedText text={row.original.bank_label} className="max-w-full" />,
        size: 120,
        meta: { exportHeaderName: "Bank", exportValue: (r: ChequeRow) => r.bank_label },
    },
    {
        accessorKey: "cheque_date",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Cheque Date" className={WRAP_HEADER} />,
        cell: ({ row }) => <div className="whitespace-nowrap">{dateText(row.original.cheque_date) || "--"}</div>,
        size: 115,
        meta: { exportHeaderName: "Cheque Date", exportValue: (r: ChequeRow) => dateText(r.cheque_date) },
    },
    {
        accessorKey: "status",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" className={WRAP_HEADER} />,
        cell: ({ row }) => {
            const changed = statusChangeText(row.original);
            return (
                <div className="flex flex-col items-start gap-0.5">
                    <ChequeStatusBadge status={row.original.status} />
                    {changed && <span className="text-[11px] leading-tight text-muted-foreground">{changed}</span>}
                </div>
            );
        },
        size: 150,
        meta: {
            exportHeaderName: "Status",
            exportValue: (r: ChequeRow) => [r.status, statusChangeText(r)].filter(Boolean).join(" "),
        },
    },
    {
        accessorKey: "amount",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Amount" className={WRAP_HEADER} />,
        cell: ({ row }) => (
            <div className="whitespace-nowrap font-medium">{formatToRoundedIndianRupee(row.original.amount)}</div>
        ),
        size: 110,
        meta: { isNumeric: true, exportHeaderName: "Amount", exportValue: (r: ChequeRow) => formatForReport(r.amount) },
    },
    {
        accessorKey: "description",
        header: "Description",
        cell: ({ row }) => <TruncatedText text={row.original.description} className="max-w-full" />,
        size: 180,
        enableSorting: false,
        meta: { exportHeaderName: "Description", exportValue: (r: ChequeRow) => r.description || "" },
    },
    {
        id: "payee",
        accessorFn: (r) => payeeOf(r).label,
        header: "Vendor / Payee",
        cell: ({ row }) => {
            const payee = payeeOf(row.original);
            if (!payee.vendor) return <TruncatedText text={payee.label} className="max-w-full" />;
            return (
                <div className="flex min-w-0 items-center gap-1">
                    <TruncatedText text={payee.label} className="max-w-full" />
                    <Link to={`/vendors/${payee.vendor}`} title="Open Vendor" className="shrink-0">
                        <Info className="h-3 w-3 text-blue-500" />
                    </Link>
                </div>
            );
        },
        size: 170,
        enableSorting: false,
        meta: { exportHeaderName: "Vendor / Payee", exportValue: (r: ChequeRow) => payeeOf(r).label },
    },
    {
        accessorKey: "owner",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Created By" className={WRAP_HEADER} />,
        cell: ({ row }) => (
            <div className="flex flex-col">
                <TruncatedText text={row.original.owner_name || row.original.owner} className="max-w-full" />
                <span className="text-[11px] text-muted-foreground">{dateText(row.original.creation)}</span>
            </div>
        ),
        size: 135,
        enableSorting: false,
        meta: {
            exportHeaderName: "Created By",
            exportValue: (r: ChequeRow) => `${r.owner_name || r.owner} ${dateText(r.creation)}`.trim(),
        },
    },
    {
        accessorKey: "attachment",
        header: "Photo",
        cell: ({ row }) => <ChequePhotoLink url={row.original.attachment} chequeNo={row.original.cheque_no} />,
        size: 80,
        enableSorting: false,
        meta: {
            exportHeaderName: "Photo",
            exportValue: (r: ChequeRow) => (r.attachment ? `${SITEURL}${r.attachment}` : ""),
        },
    },
];
