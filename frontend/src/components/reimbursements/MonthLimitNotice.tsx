/**
 * The claimant's month total in an approve dialog (owner, 2026-10-28, ADR-0040 Amendment B): a quiet line under
 * the ₹2,000 monthly limit; at or above it, a warning and a tick box the approver must tick before Approve. Used on the
 * Reimbursements page and in Payments' single approve of a reimbursement. A warning, never a block: the parent
 * only keeps Approve disabled until the box is ticked (`monthTickNeeded`).
 */

import { Checkbox } from "@/components/ui/checkbox";
import type { MonthTotal } from "@/types/NirmaanStack/Reimbursement";
import { ACKNOWLEDGE_LABEL, monthNotice, type NoticePlace } from "@/utils/reimbursements/monthLimit";

/** Whether Approve waits for the tick: at or above the limit, or when the total could not be read (the server still
 *  checks it on the Reimbursements page). */
export const monthTickNeeded = (row: MonthTotal | null | undefined, failed: boolean): boolean =>
    row ? row.over_limit : failed;

interface Props {
    row: MonthTotal | null | undefined;
    isLoading: boolean;
    failed: boolean;
    place: NoticePlace;
    /** Approving now leaves the expense waiting for L1 (`rules.approvalNeedsL1`); said on the Reimbursements page. */
    goesToL1?: boolean;
    acknowledged: boolean;
    onAcknowledgedChange: (value: boolean) => void;
    disabled?: boolean;
}

export function MonthLimitNotice({ row, isLoading, failed, place, goesToL1 = false, acknowledged, onAcknowledgedChange, disabled }: Props) {
    if (isLoading) {
        return <p className="text-xs text-muted-foreground">Checking this month's reimbursements…</p>;
    }
    if (!row && !failed) return null;

    const tick = monthTickNeeded(row, failed) && (
        <label htmlFor="reimb-month-limit-ack" className="flex items-start gap-2 text-sm">
            <Checkbox
                id="reimb-month-limit-ack"
                className="mt-0.5"
                checked={acknowledged}
                disabled={disabled}
                onCheckedChange={(v) => onAcknowledgedChange(v === true)}
            />
            <span>{ACKNOWLEDGE_LABEL}</span>
        </label>
    );

    if (!row) {
        return (
            <div className="flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                <p>This month's reimbursements for this person couldn't be read, so it isn't known whether this claim reaches the ₹2,000 monthly limit.</p>
                {tick}
            </div>
        );
    }

    const notice = monthNotice(row, place, goesToL1);
    if (!notice.over) {
        return (
            <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                {notice.headline} {notice.detail}
            </p>
        );
    }
    return (
        <div className="flex flex-col gap-2 rounded-md border border-amber-200 border-l-4 border-l-amber-500 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
            <p className="font-semibold">{notice.headline}</p>
            <p>{notice.detail}</p>
            {tick}
        </div>
    );
}
