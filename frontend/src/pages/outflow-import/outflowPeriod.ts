// src/pages/outflow-import/outflowPeriod.ts

import {
    describeDateFilter,
    timespanOptions,
    type DateFilterValue,
} from "@/components/data-table/dateFilterModel";

/**
 * The period the Bulk Import Outflow screen is scoped to (slice P1) — pure model.
 *
 * ⚠️ THERE IS EXACTLY ONE PERIOD VALUE, AND IT HAS TWO EDITORS. The `Period` control above the
 * summary and the `Payment Date` column funnel in the table both read and write THIS value. They
 * are not two filters that compose: two date filters on one column would AND together, so
 * "Last 30 days" plus "Is 01-Jan" would silently select nothing and neither control would look
 * wrong. One value with two ways in cannot produce that state.
 *
 * ⚠️ IT FILTERS `Outflow Import Row.added_on` — WHEN THE MONEY MOVED — and not a batch's declared
 * period or its upload time. Three different "periods" exist in this schema and they do not
 * coincide. `added_on` is the only one the transaction table can filter on, and the summary must
 * select the same population as the table beneath it or the two disagree, which is the whole defect
 * the 2026-08-10 ruling was about. See `_row_filters` in `review.py`.
 */

export interface PeriodPreset {
    label: string;
    /** `null` = no period filter at all ("All time"). */
    value: DateFilterValue | null;
}

/**
 * A fixed financial year, as an absolute range.
 *
 * ⚠️ STORED AS DATES, UNLIKE EVERY OTHER PRESET, AND THAT IS CORRECT. "FY 25-26" names two specific
 * dates and means the same two dates forever; a timespan word means "relative to today" and would
 * be wrong for it. The distinction is the same one `useReportDateStore` draws between a preset and
 * a custom range.
 */
const financialYear = (label: string, from: string, to: string): PeriodPreset => ({
    label,
    value: { operator: "Between", value: [from, to] },
});

/**
 * What the period rail offers.
 *
 * ⚠️ THE RELATIVE ONES ARE THE APP'S `timespanOptions`, VERBATIM, AND MUST STAY SO. The column
 * funnel offers exactly this vocabulary, and the two controls edit one value — so a word this rail
 * invents would be a window the funnel cannot display, and a word it redefines would move the
 * selection every time the value passed between them. See `OutflowPeriodFilter`'s docstring for the
 * measured mismatch that ruled out reusing the reports' `datePresets` here.
 */
export const PERIOD_PRESETS: PeriodPreset[] = [
    { label: "All time", value: null },
    ...timespanOptions.map((option) => ({
        label: option.label,
        value: { operator: "Timespan", value: option.value } as DateFilterValue,
    })),
    financialYear("FY 25-26", "2025-04-01", "2026-03-31"),
    financialYear("FY 26-27", "2026-04-01", "2027-03-31"),
];

/**
 * Where the screen opens. `null` IS "all time" -- the same value the Period control produces when
 * somebody clears it, so opening and clearing land on exactly one state.
 *
 * ⚠️ THIS REVERSES THE 2026-08-09 RULING (owner, 2026-08-12), and the reasoning it reverses is
 * recorded here rather than deleted, because it was not wrong -- it was a trade the owner has now
 * decided the other way.
 *
 * The old default was `last 30 days`, on the grounds that this screen is a WORKLIST (the same
 * reason `DEFAULT_TAB` is `not_matched` rather than `all`): opening on every transfer ever staged
 * makes the first paint slower every month the feature is used, and buries the statement somebody
 * just imported under months of settled history. BOTH OF THOSE COSTS ARE REAL AND ARE NOW ACCEPTED
 * -- a reviewer looking for an older transfer was silently shown nothing and had no reason to
 * suspect a date filter was the cause, and that was judged the worse failure.
 *
 * ⚠️ SO THE FIRST PAINT NOW SCALES WITH THE WHOLE TABLE, not with a window. If that becomes a
 * problem the fix is paging or a server-side cap, NOT quietly reinstating a default period -- the
 * reason this one was reversed is that an invisible filter is indistinguishable from missing data.
 */
export const DEFAULT_PERIOD: DateFilterValue | null = null;

/**
 * How the period reads on the trigger.
 *
 * A preset shows its own label (so "Last 30 days" reads as itself, not as two dates that will be
 * wrong tomorrow); anything else falls back to the shared `describeDateFilter`, which is the same
 * sentence the column funnel would show for that value.
 */
export const periodLabel = (value?: DateFilterValue | null): string => {
    if (!value || !value.value) return "All time";
    const preset = PERIOD_PRESETS.find(
        (p) =>
            p.value &&
            p.value.operator === value.operator &&
            JSON.stringify(p.value.value) === JSON.stringify(value.value)
    );
    if (preset) return preset.label;
    return describeDateFilter(value) || "All time";
};

// --- URL persistence -----------------------------------------------------------------------------

/**
 * The period rides the URL so a filtered screen is linkable and survives a reload.
 *
 * ⚠️ ITS OWN KEYS, NEVER THE REPORTS' `rpt_date_*`. `useReportDateStore` deliberately shares one set
 * of keys across every report so a range picked on Inflow applies on Outflow; this screen is not one
 * of those reports and its period means something different (a transfer date on staged import rows,
 * not a payment date on a ledger). Sharing the keys would make navigating between the two silently
 * rewrite the other's filter.
 *
 * ⚠️ THE OPERATOR AND THE VALUE ARE SEPARATE KEYS, so a `Between` can carry two dates without the
 * screen inventing a delimiter that a date could contain.
 */
export const PERIOD_URL_KEYS = {
    operator: "ofl_period_op",
    from: "ofl_period_from",
    to: "ofl_period_to",
} as const;

/** A stored value -> the params that represent it. `null` means "remove this key". */
export const periodToParams = (
    value?: DateFilterValue | null
): Record<string, string | null> => {
    if (!value || !value.value) {
        // ⚠️ "ALL TIME" IS STILL WRITTEN, NOT OMITTED, even though the DEFAULT is now all time too
        // and the two therefore resolve alike. Keeping `none` spelled costs one param and buys two
        // things: the URL keeps saying what the screen is showing rather than leaving the reader to
        // know the default, and if a default period is ever reintroduced, a cleared filter still
        // survives a reload instead of silently snapping back to it.
        return {
            [PERIOD_URL_KEYS.operator]: "none",
            [PERIOD_URL_KEYS.from]: null,
            [PERIOD_URL_KEYS.to]: null,
        };
    }
    if (value.operator === "Between" && Array.isArray(value.value)) {
        return {
            [PERIOD_URL_KEYS.operator]: "Between",
            [PERIOD_URL_KEYS.from]: value.value[0] ?? null,
            [PERIOD_URL_KEYS.to]: value.value[1] ?? null,
        };
    }
    return {
        [PERIOD_URL_KEYS.operator]: value.operator,
        [PERIOD_URL_KEYS.from]: typeof value.value === "string" ? value.value : null,
        [PERIOD_URL_KEYS.to]: null,
    };
};

/** The params -> a stored value. Absent (not `none`) yields the default; junk is treated as absent. */
export const periodFromParams = (
    params: Record<string, string | null | undefined>
): DateFilterValue | null => {
    const operator = (params[PERIOD_URL_KEYS.operator] || "").trim();
    if (!operator) return DEFAULT_PERIOD;
    if (operator === "none") return null;

    const from = (params[PERIOD_URL_KEYS.from] || "").trim();
    const to = (params[PERIOD_URL_KEYS.to] || "").trim();

    if (operator === "Between") {
        return from && to ? { operator: "Between", value: [from, to] } : DEFAULT_PERIOD;
    }
    if (operator === "Timespan") {
        return from ? { operator: "Timespan", value: from } : DEFAULT_PERIOD;
    }
    if (["Is", "<=", ">="].includes(operator)) {
        return from ? { operator, value: from } : DEFAULT_PERIOD;
    }
    // An operator this build does not know falls back to the default, which IS "all time" since
    // 2026-08-12. The old note here said the fallback must not "silently widen to every row ever
    // staged" -- that concern belonged to the worklist default and expired with it. Widening is
    // now the safe direction: showing everything is visibly everything, whereas a stale link
    // resolving to a narrow window hides rows with nothing on screen to say so.
    return DEFAULT_PERIOD;
};
