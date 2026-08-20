// src/utils/dateFilterRange.ts

import {
    addDays,
    addMonths,
    addYears,
    endOfMonth,
    endOfQuarter,
    endOfWeek,
    endOfYear,
    format,
    startOfMonth,
    startOfQuarter,
    startOfWeek,
    startOfYear,
    subDays,
} from "date-fns";

import type { DateFilterValue } from "@/components/data-table/dateFilterModel";

/**
 * A `DateFilterValue` resolved into the two plain dates an endpoint can bind.
 *
 * ⚠️ THIS EXISTS BECAUSE NOT EVERY ENDPOINT SPEAKS FRAPPE'S TIMESPAN VOCABULARY. The DataTable path
 * hands `{operator: "Timespan", value: "last 30 days"}` straight to Frappe's list API, which
 * resolves the WORD server-side. The Bulk Import Outflow endpoints take `date_from` / `date_to`
 * because they are hand-written SQL over one column, so somebody has to turn the word into dates.
 * Doing it here keeps the MEANING of a filter pure and testable, exactly as `serverQuery` does for
 * the rest of that screen's filters, while SQL keeps the application of it.
 *
 * ⚠️ IT MIRRORS FRAPPE'S `get_timespan_date_range` DELIBERATELY, INCLUDING THE ODD ONES. "Last
 * Month" must select the same rows on this screen as on every DataTable screen, or the same words
 * mean two things in one application. Two consequences worth knowing before you "correct" them:
 *
 *   - `this week` / `this month` / `this quarter` / `this year` end at TODAY, not at the end of the
 *     period. They are "so far this month", not "the whole month".
 *   - `last 6 months` is QUARTER-ALIGNED (the start of the quarter six months back to the end of
 *     the quarter three months back), which is not the same as "the last 180 days". That is
 *     Frappe's definition and the label users have learned.
 *
 * ⚠️ "TODAY" IS READ LIVE, INSIDE THE CALL -- never frozen at module load. A relative window
 * computed once drifts: a tab left open across midnight keeps filtering on yesterday's window,
 * which is the same trap `datePresets` documents.
 */
export interface ResolvedDateRange {
    /** `yyyy-MM-dd`, inclusive. Absent means unbounded on that side. */
    from?: string;
    to?: string;
}

const iso = (d: Date): string => format(d, "yyyy-MM-dd");

/** Frappe's week starts on Sunday; `date-fns` agrees by default. Stated so it is not "fixed". */
const WEEK_OPTIONS = undefined;

/**
 * A timespan word -> its window, relative to `today`.
 *
 * `today` is a parameter so this is a pure function and can be tested against a fixed date. Callers
 * pass nothing and get the real today.
 */
export const resolveTimespan = (
    timespan: string,
    today: Date = new Date()
): ResolvedDateRange | undefined => {
    switch ((timespan || "").trim().toLowerCase()) {
        case "today":
            return { from: iso(today), to: iso(today) };
        case "yesterday": {
            const d = subDays(today, 1);
            return { from: iso(d), to: iso(d) };
        }

        // --- previous complete periods ---
        case "last week": {
            const ref = subDays(today, 7);
            return { from: iso(startOfWeek(ref, WEEK_OPTIONS)), to: iso(endOfWeek(ref, WEEK_OPTIONS)) };
        }
        case "last month": {
            const ref = addMonths(today, -1);
            return { from: iso(startOfMonth(ref)), to: iso(endOfMonth(ref)) };
        }
        case "last quarter": {
            const ref = addMonths(today, -3);
            return { from: iso(startOfQuarter(ref)), to: iso(endOfQuarter(ref)) };
        }
        case "last 6 months":
            // Quarter-aligned, per Frappe. See the module docstring before changing this.
            return {
                from: iso(startOfQuarter(addMonths(today, -6))),
                to: iso(endOfQuarter(addMonths(today, -3))),
            };
        case "last year": {
            const ref = addYears(today, -1);
            return { from: iso(startOfYear(ref)), to: iso(endOfYear(ref)) };
        }

        // --- rolling windows, ending today ---
        case "last 7 days":
            return { from: iso(addDays(today, -7)), to: iso(today) };
        case "last 14 days":
            return { from: iso(addDays(today, -14)), to: iso(today) };
        case "last 30 days":
            return { from: iso(addDays(today, -30)), to: iso(today) };
        case "last 90 days":
            return { from: iso(addDays(today, -90)), to: iso(today) };

        // --- current periods, ending today (NOT at the period end) ---
        case "this week":
            return { from: iso(startOfWeek(today, WEEK_OPTIONS)), to: iso(today) };
        case "this month":
            return { from: iso(startOfMonth(today)), to: iso(today) };
        case "this quarter":
            return { from: iso(startOfQuarter(today)), to: iso(today) };
        case "this year":
            return { from: iso(startOfYear(today)), to: iso(today) };

        default:
            // ⚠️ AN UNKNOWN TIMESPAN RESOLVES TO NOTHING, NEVER TO A GUESS. A stale bookmark
            // carrying a word this build no longer knows shows an UNFILTERED table, which is
            // visibly odd, rather than a silently wrong window, which is not.
            return undefined;
    }
};

/**
 * Any `DateFilterValue` -> the bounds to send.
 *
 * ⚠️ `Is` BECOMES A CLOSED ONE-DAY RANGE, not an equality. The column behind it is a Datetime, so
 * `= '2026-07-01'` matches only the row that moved at exactly midnight. The endpoint's `date_to` is
 * already inclusive of the whole end day (`< date + INTERVAL '1 day'`), so from == to is right.
 *
 * ⚠️ `<=` AND `>=` PRODUCE AN OPEN-ENDED RANGE ON PURPOSE. Filling in the missing side with a
 * sentinel ("the beginning of time") would turn a half-bounded question into a bounded one and put
 * a date on screen that nobody chose.
 */
export const resolveDateFilter = (
    filter?: DateFilterValue | null,
    today: Date = new Date()
): ResolvedDateRange => {
    if (!filter || !filter.value) return {};

    switch (filter.operator) {
        case "Between": {
            if (!Array.isArray(filter.value)) return {};
            const [from, to] = filter.value;
            // Tolerated rather than trusted: a hand-edited URL can arrive back-to-front, and
            // swapping is the reading that returns rows instead of an empty table.
            if (from && to && from > to) return { from: to, to: from };
            return { from: from || undefined, to: to || undefined };
        }
        case "Timespan":
            return typeof filter.value === "string"
                ? resolveTimespan(filter.value, today) ?? {}
                : {};
        case "<=":
            return typeof filter.value === "string" ? { to: filter.value } : {};
        case ">=":
            return typeof filter.value === "string" ? { from: filter.value } : {};
        case "Is":
            return typeof filter.value === "string"
                ? { from: filter.value, to: filter.value }
                : {};
        default:
            return {};
    }
};

/** Whether a filter would actually narrow anything. An empty value is a pass-through, never "none". */
export const hasDateFilter = (filter?: DateFilterValue | null): boolean => {
    const { from, to } = resolveDateFilter(filter);
    return Boolean(from || to);
};
