/**
 * The Reimbursements tab on a user's profile (owner, 2026-10-28): one person's claims for a month, and the summary of
 * totals above the table. Admin only. The month is the one a claim was RAISED in, as the monthly reimbursement limit counts
 * it (`month_total.py`); the month total is Approved + Paid, the figure the approvers' warning shows. Pure, so the
 * month edges and the totals are tested without React (F4).
 */

import { monthLabel } from "./monthLimit";
import { APPROVED, PAID, PENDING, REJECTED, isReimbursementAdmin, overMonthlyLimit, type Viewer } from "./rules";

/** Who sees the tab: Admin only (`Administrator` and the Admin profile, the CEO included; owner, 2026-10-28). */
export const seesProfileReimbursements = (viewer: Viewer): boolean => isReimbursementAdmin(viewer);

/** The month filter's "every month" choice. */
export const ALL_MONTHS = "all";

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-10" for a date, in the browser's own time. */
export const monthKey = (date: Date): string => `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;

/** True for a "YYYY-MM" month key. */
export const isMonthKey = (value: string | null | undefined): value is string =>
    !!value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

/** The month after "YYYY-MM". */
function nextMonth(key: string): string {
    const [year, month] = key.split("-").map(Number);
    return month === 12 ? `${year + 1}-01` : `${year}-${pad(month + 1)}`;
}

/** The month filter's choices: this month first, then the `count - 1` before it, then "All months". */
export function monthOptions(now: Date, count = 12): { value: string; label: string }[] {
    const options: { value: string; label: string }[] = [];
    const cursor = new Date(now.getFullYear(), now.getMonth(), 1);
    for (let i = 0; i < count; i++) {
        const key = monthKey(cursor);
        options.push({ value: key, label: monthLabel(`${key}-01`) });
        cursor.setMonth(cursor.getMonth() - 1);
    }
    options.push({ value: ALL_MONTHS, label: "All months" });
    return options;
}

/** The table's filters for a month: raised on or after its first day and before the next month's. None for
 *  "All months". Datetimes are the site's own time, as stored. */
export function monthFilters(key: string): [string, string, string][] {
    if (!isMonthKey(key)) return [];
    return [
        ["creation", ">=", `${key}-01 00:00:00`],
        ["creation", "<", `${nextMonth(key)}-01 00:00:00`],
    ];
}

/** A row of the data table's group-by result: one status and its summed amount. */
export interface StatusSum {
    group_key: string;
    aggregate_value: number;
}

export interface ProfileTotals {
    approved: number;
    paid: number;
    pending: number;
    rejected: number;
    /** Approved + Paid: what counts toward the monthly reimbursement limit. */
    monthTotal: number;
    /** The month total has reached the ₹2,000 limit. */
    reachesLimit: boolean;
}

/** The summary above the table, from the amounts summed by status over every matching claim (not just this page). */
export function profileTotals(sums: readonly StatusSum[]): ProfileTotals {
    const of = (status: string) => Number(sums.find((s) => s.group_key === status)?.aggregate_value ?? 0);
    const approved = of(APPROVED);
    const paid = of(PAID);
    const monthTotal = approved + paid;
    return {
        approved, paid, pending: of(PENDING), rejected: of(REJECTED),
        monthTotal, reachesLimit: overMonthlyLimit(monthTotal),
    };
}
