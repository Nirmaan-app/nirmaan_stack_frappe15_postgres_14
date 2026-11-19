/**
 * The month filter on the Paid and All tabs (owner, 2026-11-19): Admin, HR and Accounts (and the CEO, who holds the
 * Admin profile) pick a month and see what it comes to. Paid narrows by the expense's paid-on date, All by the date the
 * claim was raised (`api/reimbursements/queue.get_claims`, `month`). Pure, so it is tested without React (F4).
 */

import { monthLabel } from "./monthLimit";
import { TAB_ALL, TAB_PAID, seesAllClaims, type ReimbursementTab, type Viewer } from "./rules";

/** The tabs a month narrows. */
export const MONTH_TABS: readonly ReimbursementTab[] = [TAB_PAID, TAB_ALL];

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

/** What the picker shows for a value kept in the address: a month, "all", or the current month when unreadable. */
export function resolveMonth(value: string | null | undefined, now: Date = new Date()): string {
    if (value === ALL_MONTHS) return ALL_MONTHS;
    return isMonth(value) ? value : currentMonth(now);
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

/** "November 2026". */
export const monthTitle = (month: string): string => monthLabel(`${month}-01`);

/** Whether this person gets the month filter on `tab`: Paid and All, for those who see every claim. */
export const filtersByMonth = (tab: ReimbursementTab, viewer: Viewer): boolean =>
    MONTH_TABS.includes(tab) && seesAllClaims(viewer);

/** The word for what the tab's month counts: claims paid in it (Paid) or raised in it (All). */
export const monthVerb = (tab: ReimbursementTab): string => (tab === TAB_PAID ? "Paid" : "Raised");
