/**
 * The Bulk Download selection summary (owner, 2026-10-28): two lines above the selection table, on the
 * Reports, Project and Vendor tabs alike. Every value carries its own label, so nothing is guessed:
 *
 *   Line 1: Selected 48 of 48 │ Date range (Created On) 02-Jan-2025 → 07-Jul-2025 │ Excl. GST ₹5,89,027 │ Incl. GST ₹6,96,007
 *   Line 2: Filters [Project: 6D Technology ✕] [Vendor: ACE ✕]   -- or "No filters"
 *
 * Line 1 is about the TICKED rows -- what the PDF will hold: their date range (earliest → latest on the table's
 * main date, NOT the date filter) and their totals. Line 2 lists only the filters the user set, as chips.
 * Pure rules here (F4); the table renders them.
 */
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { parseNumber } from "@/utils/parseNumber";

/** One figure a type totals over the ticked rows; `label` names its block ("Excl. GST", "Incl. GST", "Amount paid"). */
export interface SummaryAmount<T> {
    label: string;
    get: (row: T) => number | string | null | undefined;
}

/** A column filter as TanStack holds it: facets carry a string[], dates a {operator, value}. */
export interface ColumnFilterEntry {
    id: string;
    value: unknown;
}

/** One part of line 2. `text` is what shows; `full` (the whole list) is for the hover. */
export interface SummaryPart {
    key: string;
    text: string;
    full: string;
}

/** Facet picks shown before "+N more", so line 2 stays one line. */
export const SUMMARY_SHOWN_PICKS = 2;

/** `yyyy-MM-dd[...]` -> `dd-MMM-yyyy`, read at local midnight so the day never shifts. */
const day = (value: string) => formatDate(`${value.slice(0, 10)}T00:00:00`);

/** A date filter in words, or null when it filters nothing. */
export const describeDateFilter = (filter: unknown): string | null => {
    if (!filter || typeof filter !== "object") return null;
    const { operator, value } = filter as { operator?: string; value?: unknown };
    if (value === null || value === undefined || value === "") return null;
    if (operator === "Between" && Array.isArray(value) && value.length === 2) return `${day(value[0])} → ${day(value[1])}`;
    if (typeof value !== "string") return null;
    if (operator === "Is") return day(value);
    if (operator === "<=") return `on or before ${day(value)}`;
    if (operator === ">=") return `on or after ${day(value)}`;
    if (operator === "Timespan") return value.charAt(0).toUpperCase() + value.slice(1);
    return null;
};

/**
 * Line 2 (shown after "Filters by:"): every active facet, date filter and the search, in that order.
 * Nothing set -> one part reading "None". (The dates of what is ticked are line 1's, never "Any date" here.)
 */
export const describeFilters = (
    columnFilters: ColumnFilterEntry[],
    globalFilter: string,
    facetTitles: Record<string, string>,
    dateTitles: Record<string, string>,
): SummaryPart[] => {
    const parts: SummaryPart[] = [];
    const byId = new Map(columnFilters.map((f) => [f.id, f.value]));

    for (const [id, title] of Object.entries(facetTitles)) {
        const picks = byId.get(id);
        if (!Array.isArray(picks) || picks.length === 0) continue;
        const values = picks.map(String);
        const shown = values.slice(0, SUMMARY_SHOWN_PICKS).join(", ");
        const more = values.length - SUMMARY_SHOWN_PICKS;
        parts.push({
            key: id,
            text: `${title}: ${shown}${more > 0 ? ` +${more} more` : ""}`,
            full: `${title}: ${values.join(", ")}`,
        });
    }

    for (const [id, title] of Object.entries(dateTitles)) {
        const words = describeDateFilter(byId.get(id));
        if (!words) continue;
        parts.push({ key: id, text: `${title}: ${words}`, full: `${title}: ${words}` });
    }

    const search = globalFilter.trim();
    if (search) parts.push({ key: "search", text: `Search: "${search}"`, full: `Search: "${search}"` });

    if (parts.length === 0) return [{ key: "none", text: "None", full: "None" }];
    return parts;
};

/** The sum of one figure over the ticked rows; a blank or unreadable amount counts as 0. */
export const sumSelected = <T extends { name: string }>(rows: readonly T[], selectedIds: readonly string[], get: SummaryAmount<T>["get"]): number => {
    const selected = new Set(selectedIds);
    let total = 0;
    for (const row of rows) {
        if (!selected.has(row.name)) continue;
        const amount = parseNumber(get(row) ?? 0);
        if (!isNaN(amount)) total += amount;
    }
    return total;
};

/**
 * The dates the ticked rows span, earliest → latest ("02-Apr-2025 → 30-Jun-2025"; one day reads once). Takes the
 * ticked rows' date values; blank and unreadable ones are skipped, none dated -> null. Values are
 * `yyyy-MM-dd[ time]`, so text order is date order.
 */
export const dateSpan = (values: readonly unknown[]): string | null => {
    let first: string | null = null;
    let last: string | null = null;
    for (const value of values) {
        if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(value)) continue;
        const d = value.slice(0, 10);
        if (first === null || d < first) first = d;
        if (last === null || d > last) last = d;
    }
    if (first === null || last === null) return null;
    return first === last ? day(first) : `${day(first)} → ${day(last)}`;
};

/** One labelled block of line 1. */
export interface SummaryBlock {
    label: string;
    value: string;
}

/**
 * Line 1 as labelled blocks: "Selected" N of M, then (when the table has a date column) "Date range (<column>)" =
 * the ticked rows' span or "—", then one block per amount. A type with no amount (DN, DC, MIR, MTC) has none.
 */
export const selectionBlocks = <T extends { name: string }>(
    rows: readonly T[],
    selectedIds: readonly string[],
    shownCount: number,
    amounts: readonly SummaryAmount<T>[] = [],
    dates: { title: string; span: string | null } | null = null,
): SummaryBlock[] => [
    { label: "Selected", value: `${selectedIds.length.toLocaleString("en-IN")} of ${shownCount.toLocaleString("en-IN")}` },
    ...(dates ? [{ label: `Date range (${dates.title})`, value: dates.span ?? "—" }] : []),
    ...amounts.map(({ label, get }) => ({ label, value: formatToRoundedIndianRupee(sumSelected(rows, selectedIds, get)) })),
];
