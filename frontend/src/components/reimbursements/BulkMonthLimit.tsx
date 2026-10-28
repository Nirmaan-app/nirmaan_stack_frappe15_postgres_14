/**
 * The monthly reimbursement limit in Payments' bulk approve (owner, 2026-10-28, ADR-0040 Amendment B): a box naming
 * each person at or above the limit, and a tag on each reimbursement's row. Information only, with no tick box (owner):
 * the approver reads it before confirming.
 */

import type { MonthTotal } from "@/types/NirmaanStack/Reimbursement";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { MONTHLY_LIMIT } from "@/utils/reimbursements/rules";
import { peopleOverLimit, personLine, rowTag } from "@/utils/reimbursements/monthLimit";

/** The people at or above the limit among the selection's reimbursements; nothing when there are none. */
export function BulkMonthLimitBox({ rows }: { rows: readonly MonthTotal[] }) {
    const people = peopleOverLimit(rows);
    if (people.length === 0) return null;
    const claims = people.reduce((n, p) => n + p.inSelection, 0);
    return (
        <div className="mt-1.5 rounded border border-l-4 border-amber-200 border-l-amber-500 bg-amber-50 px-2 py-1.5 text-[11px] leading-snug text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span className="font-semibold text-amber-800 dark:text-amber-300">
                    Reimbursements at or above the {formatToRoundedIndianRupee(MONTHLY_LIMIT)} monthly limit
                </span>
                <span className="text-muted-foreground">
                    {claims} claim{claims === 1 ? "" : "s"} · {people.length} {people.length === 1 ? "person" : "people"}
                </span>
            </div>
            <ul className="mt-1 flex flex-col gap-1">
                {people.map((p) => (
                    <li key={p.key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2">
                        <span className="truncate font-medium">{p.claimantName}</span>
                        <span className="font-semibold tabular-nums text-amber-800 dark:text-amber-300">
                            {formatToRoundedIndianRupee(p.monthTotal)}
                        </span>
                        <span className="col-span-2 text-muted-foreground">{personLine(p)}</span>
                    </li>
                ))}
            </ul>
            <p className="mt-1 text-amber-800 dark:text-amber-300">Approving pays these people at or above the monthly limit.</p>
        </div>
    );
}

/** The tag on one reimbursement's row: its claimant's month total, amber at or above the limit. */
export function MonthLimitTag({ row }: { row: MonthTotal }) {
    const tag = rowTag(row);
    return (
        <span
            className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium leading-none ${
                tag.over
                    ? "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
                    : "bg-muted text-muted-foreground"
            }`}
        >
            {tag.text}
        </span>
    );
}
