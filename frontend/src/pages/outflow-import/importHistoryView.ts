// src/pages/outflow-import/importHistoryView.ts

import type { DateFilterValue } from "@/components/data-table/date-filter-popover";

import { DEFAULT_PERIOD } from "./outflowPeriod";
import { SOURCE_OPTIONS } from "./outflowTableModel";

/**
 * The Import History dialog's rules, and the summary card's Reset rule — pure (F4).
 *
 * ⚠️ A "MONTH" HERE IS A STATEMENT MONTH (GLOSSARY), NEVER THE SCREEN'S PERIOD. The Period control
 * filters when the money on a line MOVED; a statement month is a month the statement's DECLARED
 * period overlaps. The server applies the overlap (`list_imports(month=...)`); this module only
 * names months, steps between them and picks where the dialog opens.
 */

/** A Statement month, as `"YYYY-MM"` — the shape `list_imports(month=...)` takes. */
export type MonthKey = string;

const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;

const MONTH_NAMES = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];

/** The month a local date falls in. Local, not UTC: "this month" is the reader's month. */
export const monthKey = (date: Date): MonthKey =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

const parts = (key: MonthKey): [number, number] | null => {
    const found = MONTH_KEY.exec(key);
    return found ? [Number(found[1]), Number(found[2])] : null;
};

/** `key` moved by `delta` months, across year boundaries. A malformed key comes back unchanged. */
export const shiftMonth = (key: MonthKey, delta: number): MonthKey => {
    const parsed = parts(key);
    if (!parsed) return key;
    const index = parsed[0] * 12 + (parsed[1] - 1) + delta;
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
};

/** "October 2026". */
export const monthLabel = (key: MonthKey): string => {
    const parsed = parts(key);
    return parsed ? `${MONTH_NAMES[parsed[1] - 1]} ${parsed[0]}` : key;
};

/**
 * The months the selector offers, NEWEST FIRST: from `current` back to `earliest`.
 *
 * ⚠️ NEVER EMPTY, AND NEVER IN THE FUTURE. With nothing imported (`earliest` null) or an earliest
 * month after `current` (a statement whose period runs ahead), the list is `current` alone — the
 * dialog always has a month to stand on, and an empty month says so in words.
 */
export const monthsBetween = (earliest: MonthKey | null | undefined, current: MonthKey): MonthKey[] => {
    if (!earliest || !parts(earliest) || earliest >= current) return [current];
    const months: MonthKey[] = [];
    for (let key = current; key >= earliest; key = shiftMonth(key, -1)) months.push(key);
    return months;
};

/**
 * Where the dialog opens: the selected statement's month, otherwise this month.
 *
 * ⚠️ A STATEMENT SPANNING TWO MONTHS OPENS ON ITS **END** MONTH. It is listed under both, so either
 * shows it; the end month is the one the list is ORDERED by (`period_to DESC`), so it is where the
 * statement sits highest.
 */
export const initialHistoryMonth = (
    selected: { period_from?: string; period_to?: string } | null | undefined,
    today: Date
): MonthKey => {
    const date = (selected?.period_to || selected?.period_from || "").slice(0, 7);
    return parts(date) ? date : monthKey(today);
};

/**
 * Which source tab the dialog opens on: the selected statement's source, otherwise the screen's
 * single Source, otherwise the first source.
 *
 * ⚠️ THE TAB IS THE DIALOG'S OWN, AND IT NEVER WRITES BACK (owner ruling 2026-10-14). Reading the
 * screen's Source to choose where to OPEN is not the same as being bound to it: switching tabs
 * changes what the dialog lists and nothing else.
 */
export const initialHistoryTab = (
    selectedSource: string | null | undefined,
    screenSources: readonly string[]
): string => {
    const known = (value?: string | null) => {
        const trimmed = (value ?? "").trim();
        return SOURCE_OPTIONS.includes(trimmed) ? trimmed : null;
    };
    return (
        known(selectedSource) ??
        (screenSources.length === 1 ? known(screenSources[0]) : null) ??
        SOURCE_OPTIONS[0]
    );
};

/**
 * The statements under one source tab.
 *
 * ⚠️ A BLANK SOURCE IS IN EVERY TAB — `importsForSource`'s rule, for its reason: a statement cannot
 * be scoped out by a word it does not carry, and a statement in no tab could not be reached at all.
 */
export const importsInTab = <T extends { source?: string | null }>(
    imports: readonly T[],
    source: string
): T[] =>
    imports.filter((option) => {
        const own = (option.source ?? "").trim();
        return !own || own === source;
    });

/** Each source tab's count for the month, by the same rule `importsInTab` lists by. */
export const tabCounts = (
    imports: readonly { source?: string | null }[]
): Record<string, number> =>
    Object.fromEntries(SOURCE_OPTIONS.map((source) => [source, importsInTab(imports, source).length]));

/**
 * Does `haystack` hold every whitespace-separated word of `search`? Case-insensitive.
 *
 * Token-AND rather than one substring, so `shanu may` finds a May statement of Shanu's. ONE
 * spelling, shared by the Import selector and the History dialog's search, so the two find a
 * statement by the same words.
 */
export const matchesEveryToken = (haystack: string, search: string): boolean => {
    const tokens = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) return true;
    const text = haystack.toLowerCase();
    return tokens.every((token) => text.includes(token));
};

/** The dialog's subtitle: what is listed, then what to do. */
export const historySubtitle = (source: string, month: MonthKey): string =>
    `${source} statements covering ${monthLabel(month)}. Select one to open it.`;

/** What an empty tab says. A search that matched nothing is a different fact from an empty month. */
export const historyEmptyLabel = (source: string, month: MonthKey, search: string): string =>
    search.trim()
        ? `No ${source} statements covering ${monthLabel(month)} match that.`
        : `No ${source} statements cover ${monthLabel(month)}.`;

/**
 * Are the summary card's three controls — Source, Import, Period — all at their defaults? The Reset
 * button shows only when they are not.
 *
 * ⚠️ THESE THREE AND NO MORE. The table's own "Clear filters (N)" clears the column funnels and
 * deliberately leaves Source and Period alone (`activeFilterCount`); Reset is the other half, and
 * touches no column funnel. Two buttons that both cleared everything would leave a reader unsure
 * which one they had pressed.
 */
export const summaryScopeIsDefault = ({
    sources,
    period,
    selectedImport,
}: {
    sources: readonly string[];
    period: DateFilterValue | null | undefined;
    selectedImport?: string;
}): boolean =>
    sources.length === 0 && (period ?? null) === DEFAULT_PERIOD && !selectedImport;
