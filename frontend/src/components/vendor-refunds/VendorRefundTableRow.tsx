import { TruncatedText } from "@/components/common/TruncatedText";
import { Badge } from "@/components/ui/badge";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import type { VendorRefundRow } from "./useVendorRefunds";

/** One row of a PO's / WO's Transaction Details: a payment, or a vendor refund against the order. */
export type TransactionRow<P> =
    | { kind: "payment"; name: string; payment: P }
    | { kind: "refund"; name: string; refund: VendorRefundRow };

const dateValue = (date?: string | null) => (date ? new Date(date).getTime() : 0);

/** Payments and refunds as one list, newest payment date first; rows without a date go last. */
export const mergePaymentsAndRefunds = <P extends { name: string; payment_date?: string | null }>(
    payments: P[] | undefined,
    refunds: VendorRefundRow[] | undefined
): TransactionRow<P>[] =>
    [
        ...(payments ?? []).map((payment) => ({ kind: "payment" as const, name: payment.name, payment })),
        ...(refunds ?? []).map((refund) => ({ kind: "refund" as const, name: refund.name, refund })),
    ].sort(
        (a, b) =>
            dateValue(b.kind === "payment" ? b.payment.payment_date : b.refund.payment_date) -
            dateValue(a.kind === "payment" ? a.payment.payment_date : a.refund.payment_date)
    );

/**
 * A vendor refund in a Transaction Details table, beside the order's payments: a teal-tinted row (teal is
 * no payment status's colour), a "Refund" tag under the amount, UTR (plain text, like the payment rows),
 * date and status "Received".
 * No voucher, no delete.
 * `tdsColumn` adds the empty TDS cell the WO table has.
 */
export const VendorRefundTableRow = ({
    refund,
    tdsColumn = false,
    className,
}: {
    refund: VendorRefundRow;
    tdsColumn?: boolean;
    className?: string;
}) => (
    <TableRow className={cn("bg-teal-50 hover:bg-teal-100", className)}>
        <TableCell>
            <span className="flex flex-col items-start gap-1 whitespace-nowrap">
                {formatToRoundedIndianRupee(refund.amount)}
                <Badge variant="outline" className="border-red-500 px-1 py-0 text-[9px] leading-3 text-red-600">Refund</Badge>
            </span>
        </TableCell>
        {tdsColumn && <TableCell>--</TableCell>}
        <TableCell className="overflow-hidden truncate max-w-28">
            <TruncatedText text={refund.utr} fallback="--" className="max-w-28" />
        </TableCell>
        <TableCell>{refund.payment_date ? formatDate(refund.payment_date) : "--"}</TableCell>
        <TableCell className="whitespace-nowrap">
            <Badge variant="teal">Received</Badge>
        </TableCell>
        <TableCell className="text-center w-[10%]">--</TableCell>
        <TableCell className="w-[5%]" />
    </TableRow>
);
