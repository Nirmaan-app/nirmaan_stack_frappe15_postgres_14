/**
 * The month filter on Payment need to be paid, Paid and All (owner, 2026-11-19): Admin, HR and Accounts (and the CEO,
 * who holds the Admin profile) pick a month and see what it comes to. Payment need to be paid opens on the current
 * month; Paid and All open on all months (owner, 2026-11-19, `defaultMonth`). Paid narrows by the expense's paid-on date, All and
 * Payment need to be paid by the date the claim was raised (`api/reimbursements/queue.get_claims`, `month`). Pure, so
 * it is tested without React (F4).
 */

import { monthLabel } from "./monthLimit";
import {
    TAB_ALL,
    TAB_APPROVED,
    TAB_CEO,
    TAB_L1,
    TAB_MINE,
    TAB_PAID,
    TAB_PENDING,
    TAB_RECONCILIATION,
    TYPES,
    seesAllClaims,
    type ReimbursementTab,
    type Viewer,
} from "./rules";

/** The tabs a month narrows: Paid by the paid-on month; All and Payment need to be paid by the raised month. */
export const MONTH_TABS: readonly ReimbursementTab[] = [
    TAB_PENDING, TAB_L1, TAB_CEO, TAB_APPROVED, TAB_RECONCILIATION, TAB_PAID, TAB_ALL, TAB_MINE,
];

/** The picker's "no month" choice: every claim, as before. */
export const ALL_MONTHS = "all";

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** "2026-11" for the month `now` falls in (local time). */
export function currentMonth(now: Date = new Date()): string {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** True for a month written as YYYY-MM. */
export const isMonth = (value: string | null | undefined): value is string => !!value && MONTH_PATTERN.test(value);

/** `month` moved by `by` months: shiftMonth("2026-01", -1) is "2025-12". */
export function shiftMonth(month: string, by: number): string {
    const [year, mm] = month.split("-").map(Number);
    const index = year * 12 + (mm - 1) + by;
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** The month a tab opens on when the address names none (owner, 2026-11-19): the current month on Payment need to be
 *  paid, all months on Paid and All. Reset goes back to all months on every tab. */
export const defaultMonth = (tab: ReimbursementTab, now: Date = new Date()): string =>
    tab === TAB_APPROVED ? currentMonth(now) : ALL_MONTHS;

/** What the picker shows for a value kept in the address: a month, "all", or the tab's default when absent or
 *  unreadable. */
export function resolveMonth(value: string | null | undefined, tab: ReimbursementTab, now: Date = new Date()): string {
    if (value === ALL_MONTHS) return ALL_MONTHS;
    return isMonth(value) ? value : defaultMonth(tab, now);
}

/** The month before the current one: "This month" / "Last month" quick picks. */
export const lastMonth = (now: Date = new Date()): string => shiftMonth(currentMonth(now), -1);

/** "2026-11" -> [2026, 11]. */
export function splitMonth(month: string): [number, number] {
    const [year, mm] = month.split("-").map(Number);
    return [year, mm];
}

/** "2026-11" from a year and a 1-based month. */
export const joinMonth = (year: number, mm: number): string => `${year}-${String(mm).padStart(2, "0")}`;

/** The short month names the picker's tiles show, January first. */
export const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "Nov": the quick picks' short name, This month (Nov) / Last month (Oct). */
export const shortMonth = (month: string): string => SHORT_MONTHS[splitMonth(month)[1] - 1];

/** One figure under the month bar's total: a step (All) or a type (the other month tabs). */
export interface MonthFigure {
    key: string;
    value: number;
    /** The dot and share-bar colour (All only). */
    color?: string;
}

/** The claim statuses in the order a claim moves through them, with their colours (owner, 2026-11-19: every step, the
 *  claim carrying its expense's status). The same colours as the Status badges (`reimbursementColumns.STATUS_BADGE`). */
export const STEP_FIGURES: readonly { key: string; color: string }[] = [
    { key: "Pending Approval", color: "#b45309" },
    { key: "Requested", color: "#ea580c" },
    { key: "CEO Pending", color: "#c026d3" },
    { key: "Approved", color: "#2563eb" },
    { key: "Reconciliation Pending", color: "#7c3aed" },
    { key: "Paid", color: "#16a34a" },
    { key: "Rejected", color: "#dc2626" },
];

/** The figures under the total. All: each step with an amount, in `STEP_FIGURES` order, coloured. Elsewhere: Travel,
 *  Food and Others, always all three (₹0 when none) so they stay in the same place month to month. */
export function monthFigures(tab: ReimbursementTab, groups: readonly { group_key: string; aggregate_value: number | string }[] | null | undefined): MonthFigure[] {
    const sums = new Map<string, number>();
    for (const g of groups ?? []) sums.set(g.group_key, (sums.get(g.group_key) ?? 0) + (Number(g.aggregate_value) || 0));
    if (tab === TAB_ALL || tab === TAB_MINE) {
        return STEP_FIGURES.filter((s) => (sums.get(s.key) ?? 0) > 0).map((s) => ({ key: s.key, value: sums.get(s.key) ?? 0, color: s.color }));
    }
    return TYPES.map((t) => ({ key: t, value: sums.get(t) ?? 0 }));
}

/** "November 2026". */
export const monthTitle = (month: string): string => monthLabel(`${month}-01`);

/** Whether this person gets the month filter on `tab` (owner, 2026-11-19: every tab). Raised By Me has it for
 *  everyone, over their own claims; the other tabs are only shown to those who see every claim. */
export const filtersByMonth = (tab: ReimbursementTab, viewer: Viewer): boolean =>
    MONTH_TABS.includes(tab) && (tab === TAB_MINE || seesAllClaims(viewer));

/** The name at the start of the total's label: the status the tab holds; "All" and "Mine" on the two tabs that hold
 *  every status (owner, 2026-11-19). */
const MONTH_NAMES: Record<ReimbursementTab, string> = {
    [TAB_PENDING]: "Pending Approval",
    [TAB_L1]: "Requested",
    [TAB_CEO]: "CEO Pending",
    [TAB_APPROVED]: "Approved",
    [TAB_RECONCILIATION]: "Reconciliation Pending",
    [TAB_PAID]: "Paid",
    [TAB_ALL]: "All",
    [TAB_MINE]: "Mine",
};

/** The total's label, in two parts: the name (shown as a status badge) and when -- "Approved" + "raised in November
 *  2026", "Paid" + "paid in November 2026", "All" + "all months". */
export function monthHeading(tab: ReimbursementTab, month: string): { name: string; when: string } {
    const when = month === ALL_MONTHS ? "all months" : `${tab === TAB_PAID ? "paid" : "raised"} in ${monthTitle(month)}`;
    return { name: MONTH_NAMES[tab], when };
}
