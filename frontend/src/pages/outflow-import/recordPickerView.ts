// src/pages/outflow-import/recordPickerView.ts

/**
 * Filtering and sorting the Resolve dialog's Link-payment table (slice N1).
 *
 * PURE MODULE -- no React, no fetching. Everything here is `f(records, state) -> records`, which is
 * what makes it unit-testable without a DOM (this repo has none; see `frontend/CLAUDE.md`).
 *
 * ⚠️ THE SERVER RANKS, THIS FILE ARRANGES. The similarity ordering lives in
 * `services/outflow_import/similarity.py`, beside the tokeniser the matcher itself uses. Nothing
 * here re-scores a record: `sortRecords(records, null)` means "keep the order the server sent",
 * which IS the ranking. A second scoring implementation on this side would be free to drift from
 * the Python one, and the symptom -- a list ordered differently from the reasons printed on it --
 * would be invisible to every test on either side.
 *
 * ⚠️ THE WHOLE APPROVED POOL IS IN HAND. `search_settleable_records` now returns every settleable
 * record in one call, so filtering and sorting are local and instant: no round trip per keystroke,
 * and the facet lists below are free because the distinct values are already here. Before slice N1
 * the endpoint returned the 50 records nearest by amount and re-fetched on every keystroke.
 *
 * ⚠️ AN EMPTY SELECTION IS A PASS-THROUGH, NEVER "HIDE EVERYTHING" -- the same rule every other
 * filter in this codebase follows. Composition is AND across axes, OR within an axis.
 */

import type { SettleableRecord } from "./outflowTableModel";

/**
 * The sentinel for "this record has no vendor / no project".
 *
 * ⚠️ IT IS A REAL, SELECTABLE OPTION, NOT AN OMISSION. Every approved Non Project Expense has no
 * vendor and no project at all, so without it an entire ledger would be unreachable from the vendor
 * filter -- present in the list, but impossible to filter TO. The empty string can never collide
 * with a real vendor or project id.
 */
export const BLANK_FACET_ID = "";
export const NO_VENDOR_LABEL = "(no vendor)";
export const NO_PROJECT_LABEL = "(no project)";

export interface FacetOption {
    /** What the predicate matches on -- an id, or `BLANK_FACET_ID`. */
    id: string;
    /** What is displayed, searched and sorted. Never persisted into filter state. */
    label: string;
}

/**
 * ⚠️ FILTER STATE IS IDS, NEVER LABELS ("filter on the label, match on the id"). A vendor renamed
 * in the master would otherwise silently empty a live filter. Same rule as the pricing grid's
 * column filters.
 */
export interface RecordFilters {
    vendors: ReadonlySet<string>;
    projects: ReadonlySet<string>;
    /** Inclusive bounds. `null` means unbounded on that side. */
    amountMin: number | null;
    amountMax: number | null;
    /** Inclusive `YYYY-MM-DD` bounds against `recordSortDate`. */
    dateFrom: string | null;
    dateTo: string | null;
    /** Free text, token-matched. See `matchesText`. */
    text: string;
}

/**
 * ⚠️ A MODULE-LEVEL CONSTANT, NOT A FACTORY, because it is used as a React default. A fresh object
 * per render would give every consumer a new identity on every render and defeat the memoisation
 * around this table -- the same reason `PricingGrid` keeps `EMPTY_FILTER_SET` at module scope.
 */
export const EMPTY_FILTERS: RecordFilters = Object.freeze({
    vendors: new Set<string>(),
    projects: new Set<string>(),
    amountMin: null,
    amountMax: null,
    dateFrom: null,
    dateTo: null,
    text: "",
}) as RecordFilters;

export type RecordSortColumn = "vendor" | "project" | "date" | "amount";

export interface RecordSort {
    column: RecordSortColumn;
    dir: "asc" | "desc";
}

/**
 * The tri-state header cycle: unsorted -> ascending -> descending -> unsorted.
 *
 * ⚠️ RETURNING TO `null` MUST STAY REACHABLE. `null` is not "no opinion" -- it is the similarity
 * ranking, which is the whole point of the screen. A two-state toggle would let a reviewer sort by
 * amount and then have no way back to the ranked view except closing the dialog.
 */
export const nextSortState = (
    current: RecordSort | null,
    column: RecordSortColumn
): RecordSort | null => {
    if (!current || current.column !== column) return { column, dir: "asc" };
    if (current.dir === "asc") return { column, dir: "desc" };
    return null;
};

/**
 * The record's date as a comparable `YYYY-MM-DD`, for SORTING AND FILTERING ONLY.
 *
 * ⚠️ THIS MERGES TWO DIFFERENT MEANINGS, AND `recordDateLabel` DELIBERATELY DOES NOT (owner
 * decision Q4, 2026-08-11). Only `Project Payments` carries an approval date; neither expense
 * doctype has the field, an approver, or an approval step -- so an expense contributes its
 * last-modified timestamp instead. Ordering them together is what the owner asked for and is
 * defensible, because an ordering makes no claim about what a value MEANS.
 *
 * ⚠️ A DISPLAYED value is a different matter and the rule there is unchanged: the column still
 * reads "approved 12-Jul-2026" or "updated 12-Jul-2026" via `recordDateLabel`, because presenting a
 * modification under the word "approved" is a confident lie. If this function ever starts feeding a
 * LABEL, that ruling has been broken -- keep it on the comparison side.
 */
export const recordSortDate = (
    record: Pick<SettleableRecord, "approved_on" | "updated_on">
): string => {
    const raw = record.approved_on || record.updated_on || "";
    return raw.split(/[ T]/)[0] || "";
};

/** Distinct vendors and projects across the pool, each sorted by label, blanks last. */
export const facetValues = (
    records: readonly SettleableRecord[]
): { vendors: FacetOption[]; projects: FacetOption[] } => {
    const vendors = new Map<string, string>();
    const projects = new Map<string, string>();
    let anyBlankVendor = false;
    let anyBlankProject = false;

    for (const record of records) {
        // ⚠️ THE VENDOR HAS NO ID IN THIS PAYLOAD, so its own NAME is the identity. That is safe
        // here and would not be for the project: two vendors sharing a display name would merge
        // into one filter entry, which over-selects (shows too much) rather than hiding anything.
        if (record.vendor_name) vendors.set(record.vendor_name, record.vendor_name);
        else anyBlankVendor = true;

        if (record.project) projects.set(record.project, record.project_name || record.project);
        else anyBlankProject = true;
    }

    const toOptions = (map: Map<string, string>, blank: boolean, blankLabel: string) => {
        const options = [...map.entries()]
            .map(([id, label]) => ({ id, label }))
            .sort((a, b) => a.label.localeCompare(b.label));
        // Blanks last: it is a catch-all, not a value, and sorting it among real names by its
        // parenthesised label would put it at the top for no reason a reader could explain.
        return blank ? [...options, { id: BLANK_FACET_ID, label: blankLabel }] : options;
    };

    return {
        vendors: toOptions(vendors, anyBlankVendor, NO_VENDOR_LABEL),
        projects: toOptions(projects, anyBlankProject, NO_PROJECT_LABEL),
    };
};

/** Empty selection passes everything; otherwise the value's id must be selected. */
const passesFacet = (selected: ReadonlySet<string>, valueId: string): boolean =>
    selected.size === 0 || selected.has(valueId || BLANK_FACET_ID);

/**
 * Token-AND free-text matching over every fact on the row.
 *
 * ⚠️ TOKENS, NOT ONE SUBSTRING. The server's old `LIKE '%needle%'` needed the words typed in the
 * order the record stores them, so "hakimi 4471" found nothing even when both appeared. Every token
 * must match SOMEWHERE on the row, in any order and any field -- which is how a person searches.
 *
 * It is deliberately a plain lower-cased substring per token rather than the Python tokeniser: this
 * is a reviewer narrowing a visible list, not evidence for a ranking, and a partial word must match
 * as they type it.
 */
export const matchesText = (record: SettleableRecord, text: string): boolean => {
    const tokens = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) return true;
    const haystack = [
        record.name,
        record.vendor_name,
        record.vendor_nickname,
        record.contact_person,
        record.project_name,
        record.document_name,
        record.detail,
    ]
        .join(" ")
        .toLowerCase();
    return tokens.every((token) => haystack.includes(token));
};

/**
 * AND across axes, OR within an axis.
 *
 * ⚠️ A DATE BOUND EXCLUDES A RECORD THAT HAS NO DATE. There is no honest way to place an undated
 * record inside a range, and silently keeping it would make the bound mean something different from
 * what it says. Every payment and expense in this pool does carry one of the two dates, so this is
 * an edge rather than a population.
 */
export const applyRecordFilters = (
    records: readonly SettleableRecord[],
    filters: RecordFilters
): SettleableRecord[] =>
    records.filter((record) => {
        if (!passesFacet(filters.vendors, record.vendor_name)) return false;
        if (!passesFacet(filters.projects, record.project)) return false;

        const amount = Number(record.amount);
        if (filters.amountMin !== null && amount < filters.amountMin) return false;
        if (filters.amountMax !== null && amount > filters.amountMax) return false;

        if (filters.dateFrom || filters.dateTo) {
            const date = recordSortDate(record);
            if (!date) return false;
            if (filters.dateFrom && date < filters.dateFrom) return false;
            if (filters.dateTo && date > filters.dateTo) return false;
        }

        return matchesText(record, filters.text);
    });

/**
 * Sort by one column, or keep the server's similarity ranking when `sort` is `null`.
 *
 * ⚠️ THE SETTLEABLE SPLIT IS NOT RE-APPLIED HERE. When a reviewer sorts by amount they have asked
 * for amount order and must get it; re-imposing the split would silently disobey the control they
 * just used. The split governs the DEFAULT view, which is the one the server built.
 *
 * ⚠️ EVERY COMPARISON ENDS IN `name`, so the order is total. Two records with the same vendor must
 * not swap places between renders -- that is a list a reviewer cannot keep their eye on.
 */
export const sortRecords = (
    records: readonly SettleableRecord[],
    sort: RecordSort | null
): SettleableRecord[] => {
    if (!sort) return [...records];

    const direction = sort.dir === "asc" ? 1 : -1;
    return [...records].sort((a, b) => {
        // ⚠️ THE BLANK RULE IS APPLIED **BEFORE** THE DIRECTION MULTIPLIER, AND THAT ORDER IS THE
        // WHOLE OF IT. Folding "blanks last" into the comparison as a `+1` looks right and is
        // wrong: descending multiplies it by -1, so every record with no vendor / no date jumps to
        // the TOP of a column it has no value in. Found by the descending half of a test that
        // asserted both directions -- the ascending half passed throughout.
        const aBlank = isBlankOn(a, sort.column);
        const bBlank = isBlankOn(b, sort.column);
        if (aBlank !== bBlank) return aBlank ? 1 : -1;

        const compared = compareOn(a, b, sort.column);
        // A tie on the chosen column falls through to the record name, NOT to the previous order:
        // `Array.prototype.sort` is stable, but the input order here is itself a previous sort, so
        // relying on it would make the result depend on how the reviewer arrived at it. It is
        // deliberately UNDIRECTED, so equal rows keep one predictable order in both directions.
        return compared !== 0 ? compared * direction : a.name.localeCompare(b.name);
    });
};

/** Whether this record has no value at all in the sorted column. Amount is always a number. */
const isBlankOn = (record: SettleableRecord, column: RecordSortColumn): boolean => {
    switch (column) {
        case "date":
            return !recordSortDate(record);
        case "vendor":
            return !record.vendor_name;
        case "project":
            return !record.project_name;
        default:
            return false;
    }
};

const compareOn = (a: SettleableRecord, b: SettleableRecord, column: RecordSortColumn): number => {
    switch (column) {
        case "amount":
            return Number(a.amount) - Number(b.amount);
        case "date":
            return recordSortDate(a).localeCompare(recordSortDate(b));
        case "vendor":
            return a.vendor_name.localeCompare(b.vendor_name);
        case "project":
            return a.project_name.localeCompare(b.project_name);
        default:
            return 0;
    }
};

/** Filter, then sort. The one composition, so no caller can do the two in the wrong order. */
export const visibleRecords = (
    records: readonly SettleableRecord[],
    filters: RecordFilters,
    sort: RecordSort | null
): SettleableRecord[] => sortRecords(applyRecordFilters(records, filters), sort);

/**
 * Whether anything is narrowing or reordering the view -- what the Clear control is gated on.
 *
 * ⚠️ THE SORT COUNTS AS "ACTIVE" (owner decision Q5: "so that the view becomes normal again").
 * Normal is the similarity ranking with nothing filtered, so a reviewer who has only sorted must
 * still have a way back -- and Clear is the one control that promises it.
 */
export const hasActiveFilters = (filters: RecordFilters, sort: RecordSort | null): boolean =>
    Boolean(
        sort ||
            filters.vendors.size ||
            filters.projects.size ||
            filters.amountMin !== null ||
            filters.amountMax !== null ||
            filters.dateFrom ||
            filters.dateTo ||
            filters.text.trim()
    );

/**
 * Why this record sits where it sits, in the reviewer's words — or `""` to say nothing (slice N2).
 *
 * ⚠️ THE REASONS WERE ALWAYS ON THE WIRE AND NOTHING READ THEM. `similarity.py` computes them,
 * `_rank_browse_records` attaches them to the record the screen already renders, and
 * `SettleableRecord` declares them — and until N2 a grep across the whole frontend found no reader
 * outside the type. So a record sat third in a ranked list with nothing on screen saying why, which
 * is the state the module docstring in `similarity.py` describes as "a list people stop trusting".
 *
 * ⚠️ IT GOES SILENT UNDER AN EXPLICIT SORT, AND THAT IS THE POINT. `sort === null` IS the similarity
 * ranking (see `nextSortState`); any other value means the reviewer has asked for amount or date
 * order and got it. A "why it ranks here" caption printed over an order that is no longer the
 * ranking would be explaining a list that is not on screen — worse than saying nothing, because it
 * reads as authoritative.
 *
 * ⚠️ THE NUMERIC SCORE IS DELIBERATELY NOT SURFACED, here or anywhere. It is a weighted sum on an
 * arbitrary scale, so a reviewer cannot calibrate `1.35` against `0.9` — and a number on a screen
 * where money is confirmed invites being read as a confidence, which it is not. The sentences are
 * the half a person can actually check.
 *
 * ⚠️ THE ORDER OF THE REASONS IS THE SERVER'S AND MUST NOT BE RE-SORTED. `score_record` appends
 * them project → vendor → alias → amount, which is the owner's priority order; re-ordering them
 * alphabetically (or by anything else) would quietly contradict the ranking they explain.
 */
export const reasonCaption = (
    record: Pick<SettleableRecord, "similarity_reasons">,
    sort: RecordSort | null
): string => {
    if (sort) return "";
    const reasons = (record.similarity_reasons ?? []).filter((r) => Boolean(r && r.trim()));
    return reasons.join(" · ");
};

/**
 * A parsed number for the amount bounds, or `null`.
 *
 * ⚠️ A BLANK BOX IS `null` (unbounded), AND SO IS RUBBISH -- never `0`. `Number("")` is 0, so the
 * obvious implementation turns an empty "minimum" box into "at least zero", which reads as working
 * and silently excludes nothing... until someone types a stray character and every record vanishes
 * against a bound they cannot see.
 */
export const parseAmountBound = (value: string): number | null => {
    const text = value.trim();
    if (!text) return null;
    const parsed = Number(text.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
};
