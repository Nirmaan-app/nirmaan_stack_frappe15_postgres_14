import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import type { ChequeSummaryBucket } from "../config/chequePaymentTable.config";

const TONE: Record<ChequeSummaryBucket["key"], string> = {
    all: "text-foreground",
    pending: "text-indigo-700",
    issued: "text-blue-700",
    cleared: "text-green-700",
    cancelled: "text-red-700",
};

/**
 * The Cheque Payments report's summary strip (#1417): count and amount for All, Pending, Issued, Cleared and
 * Cancelled over the table's current filters and search. Each matching Cheque counts once, at its
 * full amount, so the figures are "cheque amounts", not line amounts.
 */
export function ChequeSummaryStrip({ buckets, loading }: { buckets: ChequeSummaryBucket[]; loading?: boolean }) {
    return (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border bg-card px-4 py-2">
            <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                Cheque amounts
                {loading && <Loader2 className="h-3 w-3 animate-spin" />}
            </span>
            {buckets.map((b) => (
                <div key={b.key} className="flex items-baseline gap-1.5 text-sm">
                    <span className={cn("font-medium", TONE[b.key])}>{b.label}</span>
                    <span className="text-muted-foreground">{b.count}</span>
                    <span className="font-semibold tabular-nums">{formatToRoundedIndianRupee(b.amount)}</span>
                </div>
            ))}
        </div>
    );
}
