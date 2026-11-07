/**
 * Cells shared by the expense bill tables of Vendor Invoice Recon (spec #1637): Pending Approval and All Invoices
 * -> Cashbook / Credit Card, and the money and file cells of All Invoices -> Porter.
 */
import type { HeaderContext } from "@tanstack/react-table";

import { TruncatedText } from "@/components/common/TruncatedText";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import SITEURL from "@/constants/siteURL";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import type { BillCheckResult } from "../utils/expenseBillApprovalView";

interface MoneyCellProps {
    value: number | null | undefined;
}

/** Whole rupees, right-aligned; "--" for none. */
export const MoneyCell = ({ value }: MoneyCellProps) => (
    <div className="text-right whitespace-nowrap tabular-nums">
        {value === null || value === undefined ? "--" : formatToRoundedIndianRupee(value)}
    </div>
);

/** A sortable header aligned over a right-aligned column. */
export const rightAlignedHeader = <TRow,>(title: string) => ({ column }: HeaderContext<TRow, unknown>) => (
    <div className="w-full flex justify-end"><DataTableColumnHeader column={column} title={title} /></div>
);

interface FileLinkCellProps {
    file: string | null;
    label?: string;
}

/** A link that opens the file in a new tab; "--" when there is none yet. */
export const FileLinkCell = ({ file, label = "View" }: FileLinkCellProps) =>
    file ? (
        <a href={`${SITEURL}${file}`} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">{label}</a>
    ) : (
        <span className="text-muted-foreground">--</span>
    );

interface BillCheckResultCellProps {
    row: { bill_check: BillCheckResult; bill_check_reason: string | null };
}

/** A bill's Bill check result, its reason beneath. */
export const BillCheckResultCell = ({ row }: BillCheckResultCellProps) => (
    <div>
        <div className="font-medium">{row.bill_check}</div>
        {row.bill_check_reason && <TruncatedText text={row.bill_check_reason} className="max-w-full text-xs text-muted-foreground" />}
    </div>
);

interface InvoiceNoDateCellProps {
    row: { invoice_no: string | null; invoice_date: string | null };
}

/** The invoice number over its date; "--" for either missing. */
export const InvoiceNoDateCell = ({ row }: InvoiceNoDateCellProps) => (
    <div className="whitespace-nowrap">
        <TruncatedText text={row.invoice_no || "--"} className="max-w-full" />
        <div className="text-xs text-muted-foreground">{row.invoice_date ? formatDate(row.invoice_date) : "--"}</div>
    </div>
);

/** The export value of the invoice number and date: "<number> / <date>", either left out when missing. */
export const invoiceNoDateText = (row: InvoiceNoDateCellProps["row"]): string =>
    [row.invoice_no ?? "", row.invoice_date ? formatDate(row.invoice_date) : ""].filter(Boolean).join(" / ");
