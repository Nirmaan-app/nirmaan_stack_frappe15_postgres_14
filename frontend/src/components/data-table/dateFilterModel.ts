// src/components/data-table/dateFilterModel.ts
//
// PURE MODULE -- no React, no DOM. The vocabulary and the value shape of the app's date filter.
//
// ⚠️ IT IS SPLIT OUT FROM `date-filter-popover.tsx` SO PURE MODELS CAN READ IT. `outflowPeriod.ts`
// and `outflowTableModel.ts` both declare themselves React-free -- the outflow screen keeps every
// testable decision out of its components precisely because this repository has NO DOM test
// environment -- and importing a runtime value from a `.tsx` would pull React into their graph and
// quietly end that. The popover re-exports everything here, so callers that already import from it
// are unaffected and there is still only one vocabulary.

import { format } from "date-fns";

/**
 * The stored shape of a date filter.
 *
 * `value` is an array only for `Between`; a `Timespan` holds the WORD ("last 30 days"), never dates
 * -- which is what keeps a relative window relative across a reload.
 */
export interface DateFilterValue {
    operator: string;
    value: string | string[] | null;
}

export const dateOperators = [
    { value: "Is", label: "Is" },
    { value: "Between", label: "Between" },
    { value: "<=", label: "On or Before" },
    { value: ">=", label: "On or After" },
    { value: "Timespan", label: "Timespan" },
];

/**
 * The relative windows the app offers.
 *
 * ⚠️ THESE WORDS ARE FRAPPE'S, AND THEIR MEANINGS ARE FRAPPE'S TOO. The DataTable path sends the
 * word to Frappe's list API, which resolves it server-side; `utils/dateFilterRange.ts` mirrors those
 * definitions for endpoints that take plain dates instead. Adding a label here without teaching that
 * resolver about it gives a control an option that silently filters nothing.
 */
export const timespanOptions = [
    // Relative to today
    { value: "today", label: "Today" },
    { value: "yesterday", label: "Yesterday" },
    { value: "last week", label: "Last Week" },
    { value: "last month", label: "Last Month" },
    { value: "last quarter", label: "Last Quarter" },
    { value: "last 6 months", label: "Last Half Year" },
    { value: "last year", label: "Last Year" },
    // Rolling period
    { value: "last 7 days", label: "Last 7 days" },
    { value: "last 14 days", label: "Last 14 days" },
    { value: "last 30 days", label: "Last 30 days" },
    { value: "last 90 days", label: "Last 90 days" },
    // Specific periods
    { value: "this week", label: "This Week" },
    { value: "this month", label: "This Month" },
    { value: "this quarter", label: "This Quarter" },
    { value: "this year", label: "This Year" },
];

/** `Date` -> the `yyyy-MM-dd` a filter value stores. */
export const formatDateForFilterValue = (date: Date | undefined | null): string | undefined =>
    date ? format(date, "yyyy-MM-dd") : undefined;

/**
 * `yyyy-MM-dd` -> `Date`, at LOCAL midnight.
 *
 * ⚠️ THE `T00:00:00` IS LOAD-BEARING. `new Date('2026-07-01')` parses as UTC midnight, which is the
 * previous day in any timezone behind UTC -- so the date a person picked would render as the day
 * before. Appending a time forces local parsing.
 */
export const parseFilterDate = (dateString: string | undefined | null): Date | undefined => {
    if (!dateString) return undefined;
    try {
        const date = new Date(dateString + "T00:00:00");
        if (isNaN(date.getTime())) return undefined;
        return date;
    } catch {
        return undefined;
    }
};

/** How a filter value reads on screen. Shared so a trigger and a caption cannot word it differently. */
export const describeDateFilter = (filter?: DateFilterValue | null): string => {
    if (!filter || !filter.value) return "";
    const operatorLabel =
        dateOperators.find((op) => op.value === filter.operator)?.label || filter.operator;

    if (filter.operator === "Between" && Array.isArray(filter.value)) {
        const from = parseFilterDate(filter.value[0]);
        const to = parseFilterDate(filter.value[1]);
        return `${from ? format(from, "dd-MMM-yyyy") : "?"} – ${
            to ? format(to, "dd-MMM-yyyy") : "?"
        }`;
    }
    if (filter.operator === "Timespan" && typeof filter.value === "string") {
        return timespanOptions.find((t) => t.value === filter.value)?.label || filter.value;
    }
    if (typeof filter.value === "string") {
        const date = parseFilterDate(filter.value);
        return `${operatorLabel} ${date ? format(date, "dd-MMM-yyyy") : "?"}`;
    }
    return "";
};
