// src/pages/outflow-import/components/CollectPaymentsReview.tsx

import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import { CollectPaymentLine, collectPaymentsHeading } from "../cashbookCollect";

/**
 * Review's highlight of the statement's Collect payments (#1595): a shop asked for the money and the employee
 * approved it, so it may not be a company spend. None is recorded by the import; each stays an open line on the
 * main table for a person to Create or Skip by hand. Amber, like every "look at this" prompt on Review.
 */
export const CollectPaymentsReview = ({ lines }: { lines: CollectPaymentLine[] }) => {
    const heading = collectPaymentsHeading(lines);
    if (!heading) return null;
    return (
        <div className="rounded-md border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30">
            <p className="px-2 py-1.5 text-sm text-amber-800 dark:text-amber-400">{heading}</p>
            <div className="border-t border-amber-200 dark:border-amber-800">
                {lines.map((line) => (
                    <div
                        key={line.transfer_id || line.row_number}
                        className="flex items-baseline gap-3 px-3 py-1.5 text-xs"
                    >
                        <span className="w-24 shrink-0 text-right tabular-nums">
                            {formatToRoundedIndianRupee(line.amount)}
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className="block truncate">{line.beneficiary_name || line.remarks}</span>
                            <span className="block truncate text-muted-foreground">
                                {line.spent_by ? `approved by ${line.spent_by}` : line.transfer_id}
                            </span>
                        </span>
                        <span className="shrink-0 font-medium text-amber-800 dark:text-amber-400">{line.reason}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};
