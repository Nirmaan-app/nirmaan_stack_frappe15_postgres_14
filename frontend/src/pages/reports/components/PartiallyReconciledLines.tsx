import React, { useState } from "react";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { PartiallyReconciledFigure } from "../hooks/usePartiallyReconciled";
import { PartiallyReconciledDialog } from "./PartiallyReconciledDialog";

/**
 * What the headline figure above these lines is made of: the Paid rows in the table, plus the
 * confirmed part of records still Reconciliation Pending.
 *
 * ⚠️ THE BIG NUMBER IS THE TOTAL, AND THESE LINES ARE ITS PARTS (owner, 2026-09-23). The
 * caller adds `done.amount` to its own paid figure before printing it -- so the first line here
 * is NOT the headline repeated, it is the smaller number the headline used to be.
 *
 * ⚠️ IT RENDERS NOTHING AT ZERO, and the caller's headline is then its plain paid figure. A
 * report whose range holds no part-reconciled money looks exactly as it always did, rather than
 * carrying a permanent breakdown into two lines one of which is ₹0.
 *
 * ⚠️ THE `+` IS THE POINT, not decoration. It is what says the second line is added to the
 * first to reach the figure above, rather than being another total standing beside it.
 *
 * ⚠️ "+ Partially Reconciled" OPENS THE RECORDS BEHIND IT (owner, 2026-09-24) -- unless the caller
 * passes `withDetails={false}`. The Excl. GST tile does: its figure has GST taken out, so a list
 * of incl.-GST amounts under it would not add up to the line the reader clicked.
 *
 * Tones are passed in because the two reports' tiles are different colours (red / rose) and the
 * lines have to belong to the tile they sit in.
 */
export const PartiallyReconciledLines: React.FC<{
    done: PartiallyReconciledFigure;
    /** The Paid-only figure -- what the headline showed before `done` was added to it. */
    paidAmount: number;
    /** Muted tone for the part lines; the tile's strong tone stays on the headline above. */
    mutedClassName: string;
    borderClassName: string;
    /** Whether "+ Partially Reconciled" opens the list of records. Default true. */
    withDetails?: boolean;
}> = ({ done, paidAmount, mutedClassName, borderClassName, withDetails = true }) => {
    const [open, setOpen] = useState(false);
    if (!done.amount) return null;
    const line = (label: string, amount: number, suffix?: string) => (
        <div className={`flex items-center justify-between gap-2 ${mutedClassName}`}>
            <span className="truncate">
                {label}
                {suffix && <span className="opacity-70"> {suffix}</span>}
            </span>
            <span className="font-semibold whitespace-nowrap">
                {formatToRoundedIndianRupee(amount)}
            </span>
        </div>
    );
    return (
        <div className={`mt-2 pt-2 border-t ${borderClassName} space-y-1 text-[11px] tabular-nums`}>
            {/* ⚠️ "Amount Paid" IS THE TABLE'S OWN COLUMN HEADING, and "Partially Reconciled" is
                what the payments summary card calls this money. Both are borrowed on purpose: a
                figure that appears on two screens under two names reads as two figures. */}
            {line("Amount Paid", paidAmount)}
            {withDetails ? (
                <button
                    type="button"
                    onClick={() => setOpen(true)}
                    className="block w-full text-left underline decoration-dotted underline-offset-2 hover:opacity-80"
                    title="Show the records"
                >
                    {line("+ Partially Reconciled", done.amount, `(${done.count})`)}
                </button>
            ) : (
                line("+ Partially Reconciled", done.amount, `(${done.count})`)
            )}
            {withDetails && (
                <PartiallyReconciledDialog open={open} onOpenChange={setOpen} done={done} />
            )}
        </div>
    );
};
