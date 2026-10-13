import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/utils/FormatDate";
import { hasNoBankProof } from "./waitingRefundExits";
import type { VendorRefundRow } from "./useVendorRefunds";

/**
 * "No bank proof" (#1403): an Admin marked this refund Received with no bank line, and no Bulk Import
 * credit line has been matched to it yet. Shows who marked it, when and why. Renders nothing otherwise.
 */
export const NoBankProofBadge = ({
    refund,
}: {
    refund: Pick<
        VendorRefundRow,
        "status" | "no_bank_line" | "no_bank_line_by" | "no_bank_line_at" | "no_bank_line_reason"
    >;
}) => {
    if (!hasNoBankProof(refund)) return null;
    // A Frappe datetime, "2026-10-13 11:30:05.123456": the date as dd-MMM-yyyy, then HH:mm.
    const at = refund.no_bank_line_at
        ? `${formatDate(refund.no_bank_line_at.replace(" ", "T"))} ${refund.no_bank_line_at.slice(11, 16)}`
        : null;
    const marked = [refund.no_bank_line_by, at]
        .filter(Boolean)
        .join(", ");
    return (
        <span className="flex max-w-56 flex-col items-start gap-0.5 whitespace-normal">
            <Badge variant="outline" className="whitespace-nowrap border-amber-500 text-amber-700">
                No bank proof
            </Badge>
            <span className="text-[11px] leading-tight text-muted-foreground">
                {marked && <>Marked by {marked}</>}
                {refund.no_bank_line_reason && <span className="block italic">"{refund.no_bank_line_reason}"</span>}
            </span>
        </span>
    );
};
