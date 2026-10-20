// Rent / TDS / Net under an Office Rent expense's amount (spec #1522, #1527).
//
// ⚠️ "TDS" HERE IS TAX DEDUCTED AT SOURCE (section 194-I, rent), not a Technical Data Sheet.
//
// Draws what `utils/expenses/expenseTds.shownExpenseTds` decides (a forecast before approval, the stored
// record after it) and nothing for any other expense, so a screen passes its answer and never decides
// itself. Read by the payments queue's Amount cell, the approve dialog, the request page and the
// Expenses and Non-Project Expenses lists.

import React from "react";

import { cn } from "@/lib/utils";
import { ShownExpenseTds, tdsSplitCaption, tdsSplitLines } from "@/utils/expenses/expenseTds";

interface ExpenseTdsBreakdownProps {
    shown: ShownExpenseTds | null;
    /** "cell": three small lines under a table's amount, the caption on hover. "block": the caption
     *  and the three lines, for a dialog or a page. */
    variant?: "cell" | "block";
    className?: string;
}

export const ExpenseTdsBreakdown: React.FC<ExpenseTdsBreakdownProps> = ({ shown, variant = "cell", className }) => {
    if (!shown) return null;
    const lines = tdsSplitLines(shown);
    const caption = tdsSplitCaption(shown);

    if (variant === "cell") {
        return (
            <div className={cn("text-[10px] leading-tight text-muted-foreground tabular-nums", className)} title={caption}>
                {lines.map((l) => (
                    <div key={l.label} className={l.label === "Net" ? "font-medium text-foreground" : undefined}>
                        {l.label} {l.value}
                    </div>
                ))}
            </div>
        );
    }

    return (
        <div className={cn("text-xs", className)}>
            <dl className="grid w-fit grid-cols-[auto_auto] gap-x-4 gap-y-0.5 tabular-nums">
                {lines.map((l) => (
                    <React.Fragment key={l.label}>
                        <dt className="text-muted-foreground">{l.label}</dt>
                        <dd className={cn("text-right", l.label === "Net" && "font-semibold")}>{l.value}</dd>
                    </React.Fragment>
                ))}
            </dl>
            <p className="mt-1 text-muted-foreground">{caption}</p>
        </div>
    );
};

export default ExpenseTdsBreakdown;
