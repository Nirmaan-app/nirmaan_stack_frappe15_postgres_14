// src/pages/outflow-import/outflowTableModel.ts
//
// PURE MODULE -- no React, no fetching, no DOM. The model behind the batch screen's three tabs
// (slice V4).
//
// ⚠️ THIS FILE EXISTS BECAUSE OF WHAT CANNOT BE TESTED. There is no DOM test environment in this
// repository, by deliberate choice, so the table, the dialog and the selection behaviour are React
// semantics and are structurally untestable here. Everything that is NOT a React semantic --
// which columns exist, what a filter means, what "decided" means, what the search matches -- is
// pulled out into this file so it can be covered. What is left in the components is genuinely only
// rendering, and the honest verification for that is a live browser walk.
//
// ONE COLUMN MODEL DRIVES HEADERS, SORTING, FILTERING AND THE BODY. Headers and filtering cannot
// drift because they read the same definition -- the same reason the Rate Master viewer keeps a
// unified `columns` array rather than a header list beside a predicate.

import type { DateFilterValue } from "@/components/data-table/dateFilterModel";
import { resolveDateFilter } from "@/utils/dateFilterRange";
import { formatDate } from "@/utils/FormatDate";
import {
    OPEN_ROW_STATUSES,
    ROW_MATCHED,
    ROW_MISMATCHED,
    ROW_PENDING_MATCH,
    ROW_SETTLED,
    rowStatusLabel,
} from "./outflowImportStatus";
import { paymentHref } from "@/pages/ProjectPayments/config/projectPaymentsTable.config";
import type {
    OutflowImportRow,
    OutflowRowsPage,
} from "@/types/NirmaanStack/OutflowImportBatch";

/** Which ledger a row is being settled against, or a brand-new expense. */
export type DecisionTarget =
    | "Project Payments"
    | "Project Expenses"
    | "Non Project Expenses"
    | "new";

/** The reviewer's in-progress decision for one row. Client state until they confirm. */
export interface RowDecision {
    /**
     * Which ledger this settles against, or `new`.
     *
     * ⚠️ OPTIONAL SINCE THE THREE "link to a ..." CARDS BECAME ONE (slice R2). The reviewer used to
     * pick a LEDGER first and a record second, so the target was known before the record was. Now
     * one list spans all three ledgers and the target arrives WITH the record that was chosen --
     * which is the right way round, because a reviewer recognises a record, they do not classify a
     * transfer. An entry with no target is a row someone has opened, or deliberately cleared.
     */
    target?: DecisionTarget;
    /** The record to settle. Required, with `target`, for everything except `new`. */
    linkTo?: string | null;
    /** Only for `target: "new"`. */
    newExpense?: {
        doctype: "Project Expenses" | "Non Project Expenses";
        project?: string | null;
        expenseType?: string | null;
        description?: string;
        vendor?: string | null;
    };
}

/**
 * ⚠️ `date` IS NOT A FACET, AND IT USED TO BE (slice P1). `added_on` shipped as `filter: "facet"`,
 * which offers a tick box per DISTINCT VALUE — one per calendar day the statement touched, growing
 * without limit as the table does, and unable to express "everything after the 14th" at all. It is
 * now the app's standard date filter (`DateFilterPopover`, the same control every DataTable screen
 * uses), which speaks operators and Frappe's timespan words instead.
 */
export type ColumnFilterKind = "facet" | "text" | "range" | "date" | "none";

export interface OutflowColumn {
    id: string;
    title: string;
    /** The value used for sorting, filtering and faceting. Never for rendering. */
    get: (row: OutflowImportRow) => string | number | null | undefined;
    filter: ColumnFilterKind;
    align?: "right";
    mono?: boolean;
    /** Ships hidden; available from the Columns menu. */
    hiddenByDefault?: boolean;
    width: string;
}

/**
 * The columns, in order.
 *
 * ⚠️ Bank a/c, IFSC and Time SHIP HIDDEN (owner ruling). They are real and occasionally needed,
 * and putting them in the default row costs every reader horizontal space on every visit to serve
 * a rare lookup. The Columns menu is where any further field belongs, for the same reason.
 */
export const OUTFLOW_COLUMNS: OutflowColumn[] = [
    // ⚠️ THE PERIOD CONTROL ABOVE THE SUMMARY EDITS THIS SAME FILTER (slice P1). It is not a second
    // date filter that ANDs with this one -- see `PERIOD_COLUMN_ID` below.
    { id: "added_on", title: "Payment Date", get: (r) => dateOnly(r.added_on), filter: "date", mono: true, width: "126px" },
    { id: "beneficiary_name", title: "Beneficiary", get: (r) => r.beneficiary_name ?? "", filter: "facet", width: "230px" },
    { id: "amount", title: "Amount Paid", get: (r) => r.amount ?? 0, filter: "range", align: "right", width: "140px" },
    { id: "remarks", title: "Remarks", get: (r) => r.remarks ?? "", filter: "text", width: "230px" },
    { id: "bank_reference_no", title: "Reference (UTR)", get: (r) => r.bank_reference_no ?? "", filter: "text", mono: true, width: "170px" },
    { id: "row_status", title: "Status", get: (r) => r.row_status ?? "", filter: "facet", width: "130px" },
    // The Outcome cell is a BUTTON, not text, so it neither sorts nor filters -- there is nothing
    // meaningful to order "open this dialog" by.
    // ⚠️ NARROWED FROM 320px (owner, 2026-08-10) once the outcome NOTE moved out of the button and
    // onto its own line. The old width existed to fit a sentence inside a control; the control now
    // holds a verb, and 320px of it was whitespace on every terminal row.
    { id: "outcome", title: "Outcome", get: (r) => r.outcome_note ?? r.skip_reason ?? "", filter: "none", width: "220px" },
    // ⚠️ NEW AT X3, AND IT ONLY MAKES SENSE FROM X3 ON. The batch screen showed one import, so
    // naming it in every row would have been noise. The master table spans every import, and
    // "which statement did this come from" becomes a real question the moment it does.
    { id: "import_batch", title: "Import", get: (r) => r.import_filename ?? r.import_batch ?? "", filter: "facet", width: "170px" },
    { id: "bank_account", title: "Bank a/c", get: (r) => r.bank_account ?? "", filter: "facet", mono: true, hiddenByDefault: true, width: "120px" },
    { id: "ifsc", title: "IFSC", get: (r) => r.ifsc ?? "", filter: "facet", mono: true, hiddenByDefault: true, width: "120px" },
    { id: "time", title: "Time", get: (r) => timeOnly(r.added_on), filter: "facet", mono: true, hiddenByDefault: true, width: "84px" },
];

export const DEFAULT_HIDDEN_COLUMNS: string[] = OUTFLOW_COLUMNS.filter(
    (c) => c.hiddenByDefault
).map((c) => c.id);

/**
 * The three tabs (owner ruling 2026-08-10, replacing Pending / Settled / Skipped).
 *
 * ⚠️ THERE IS NO SKIPPED TAB, AND `all` EXCLUDES SKIPPED TOO. "All" here means everything a person
 * might still act on, not every row in the table. Skipped rows are bookkeeping -- a failed
 * transfer, a duplicate, a payment already ticked Paid by hand -- and the import summary panel's
 * auto/manual split line is now the ONLY place they are reported. The server enforces this in
 * `_SCOPE_STATUSES`; this half only has to ask for the right scope.
 *
 * ⚠️ MATCHED AND SETTLED SHARE A TAB, which pairs an OPEN status with a TERMINAL one. That is the
 * reviewer's grouping, not the vocabulary's: both mean "this transfer has a record". The
 * consequence is that the tab holds a mix, which is why row selection is per-row on this screen
 * rather than per-tab.
 */
export type OutflowTab = "all" | "notMatched" | "matched";

export const OUTFLOW_TABS: { id: OutflowTab; label: string }[] = [
    { id: "all", label: "All" },
    { id: "notMatched", label: "Not-Matched" },
    { id: "matched", label: "Matched / Settled" },
];

/** Where the screen opens: the work, not the archive (owner ruling 2026-08-09, carried across). */
export const DEFAULT_TAB: OutflowTab = "notMatched";

/**
 * The scope names the endpoint knows, which are also the keys of its `tab_counts`.
 *
 * ⚠️ DERIVED FROM THE PAYLOAD TYPE, not written out again. The counts label the tabs, so the map
 * below and the counts have to agree about what a scope is called -- and the compiler now enforces
 * it: renaming a scope server-side breaks this file rather than silently rendering "—" under a tab.
 */
export type OutflowScope = keyof OutflowRowsPage["tab_counts"];

/**
 * The tab, as the scope name the server knows it by.
 *
 * ⚠️ THE TWO VOCABULARIES DIFFER ON PURPOSE AND THIS IS THE ONE PLACE THEY MEET. The screen's ids
 * are camelCase because they are TypeScript; the endpoint's are snake_case because they are Python
 * and appear in URLs. An unmapped tab would silently scope to the server's fallback rather than to
 * what the label promises.
 */
export const SCOPE_FOR_TAB: Record<OutflowTab, OutflowScope> = {
    all: "all",
    notMatched: "not_matched",
    matched: "matched",
};

/** One number a tab is labelled with. `count` is `null` when the page has not answered yet. */
export interface TabCountPart {
    /** Stable React key, and the status this part counts when it counts one. */
    key: string;
    count: number | null;
    /** Absent on a single-part tab: one number under a tab needs no word to tell it from another. */
    label?: string;
    /** Tone class. Absent means the neutral chip — see `OutflowRowsTable`'s status tones. */
    tone?: string;
}

/**
 * How a tab's count renders — ONE number, or the split when one number would mean two things.
 *
 * ⚠️ THE `matched` TAB IS THE WHOLE REASON THIS EXISTS, AND IT IS NOT A STYLING CHOICE. That tab
 * holds `Matched` (OPEN — somebody still owes it a decision) beside `Settled` (TERMINAL — money
 * written), because to a reviewer both mean "this transfer has a record". A single total cannot say
 * which, and the failure is not symmetric: it reads as the terminal one. Live-observed on the first
 * real statement — the tab read `863` while `settled_rows` was `0`, and it was understood as 863
 * transfers finished. Nothing on that screen contradicted it; the "0 Settled" chip sat in a panel
 * describing one import, four inches away and much quieter.
 *
 * The two other tabs each hold statuses that are all open, so their single number already means one
 * thing and they stay a single number. THIS IS NOT AN OVERSIGHT TO TIDY UP LATER: splitting a tab
 * whose parts are not meaningfully different would add noise and teach people to ignore the split
 * on the one tab where it carries a fact.
 *
 * ⚠️ IT FALLS BACK TO THE SINGLE TOTAL when `statusCounts` is absent, and the fallback is load
 * bearing rather than defensive. A client running against a server that predates `status_counts`
 * gets exactly the old rendering instead of two zeroes — a tab confidently reporting `0 matched ·
 * 0 settled` over a populated table would be a far worse lie than the one this function fixes.
 */
export function tabCountParts(
    tab: OutflowTab,
    tabCounts?: OutflowRowsPage["tab_counts"],
    statusCounts?: OutflowRowsPage["status_counts"]
): TabCountPart[] {
    const scope = SCOPE_FOR_TAB[tab];
    const total = tabCounts ? (tabCounts[scope] ?? null) : null;

    if (tab !== "matched" || !statusCounts) {
        return [{ key: scope, count: total }];
    }

    return [
        {
            key: ROW_MATCHED,
            count: statusCounts[ROW_MATCHED] ?? 0,
            label: "matched",
            tone: "bg-sky-50 text-sky-700",
        },
        {
            key: ROW_SETTLED,
            count: statusCounts[ROW_SETTLED] ?? 0,
            label: "settled",
            tone: "bg-emerald-50 text-emerald-700",
        },
    ];
}

// ⚠️ `tabForStatus` WENT WITH THE SUMMARY'S CLICKABLE CHIPS (owner ruling 2026-08-10). Its only
// caller mapped a clicked status figure to the tab that holds it; with the chips reduced to
// figures there is nothing left that needs to answer "which tab does this status live in", and a
// mapping kept alive with no caller is one more thing to keep in step with `_SCOPE_STATUSES`.

// ⚠️ `rowsForTab` AND `tabCounts` WENT WITH THE CLIENT FILTER ENGINE (slice X3). Both partitioned
// the rows the browser was holding, which was every row of one import. The master table holds ONE
// PAGE of every import, so a count taken from it would describe the page rather than the table --
// and `get_outflow_rows` returns `tab_counts` computed under the same filters, which is the number
// the tabs actually need.

// --- search ------------------------------------------------------------------------------------

/**
 * The three fields a person actually remembers a transfer by (owner ruling).
 *
 * Scoped deliberately: searching every column would match a status or an amount the reader did not
 * mean and make the hit-highlight land somewhere confusing.
 */
export const SEARCHABLE_FIELDS: (keyof OutflowImportRow)[] = [
    "remarks",
    "bank_reference_no",
    "beneficiary_name",
];

/**
 * ⚠️ THERE IS NO CLIENT-SIDE SEARCH, FILTER OR SORT ANY MORE (slice X3), AND THE DELETION WAS THE
 * POINT. `matchesQuery`, `passesFilters`, `visibleRows` and `facetValues` used to answer "which
 * rows match" in the browser, over the whole of one import. The master table spans EVERY import and
 * is paged, so the server has to answer it -- and the moment the server can, a second copy in here
 * is a second opinion that will disagree the day somebody edits one of them (ADR-0010 F1/F3).
 *
 * What lives here now is `serverQuery`: the pure translation from what the screen is showing to
 * what the endpoint is asked. The MEANING of a filter is still testable; the APPLICATION of it is
 * SQL. `highlightSegments` stays, because highlighting a hit is rendering, not filtering.
 */

/**
 * Split `text` into alternating non-match / match segments for the hit highlight.
 *
 * Returned as DATA rather than markup so the component decides how a hit looks and this stays
 * testable. Every segment is present in order, so joining them reproduces the input exactly --
 * a highlighter that drops characters is a bug that only shows on unusual data.
 */
export const highlightSegments = (
    text: string | null | undefined,
    query: string
): { text: string; hit: boolean }[] => {
    const source = String(text ?? "");
    const needle = query.trim().toLowerCase();
    if (!needle || !source) return source ? [{ text: source, hit: false }] : [];

    const segments: { text: string; hit: boolean }[] = [];
    const haystack = source.toLowerCase();
    let cursor = 0;
    for (;;) {
        const at = haystack.indexOf(needle, cursor);
        if (at < 0) break;
        if (at > cursor) segments.push({ text: source.slice(cursor, at), hit: false });
        segments.push({ text: source.slice(at, at + needle.length), hit: true });
        cursor = at + needle.length;
    }
    if (cursor < source.length) segments.push({ text: source.slice(cursor), hit: false });
    return segments;
};

// --- filters -----------------------------------------------------------------------------------

export interface RangeFilter {
    min?: number | null;
    max?: number | null;
}

/** Facet -> the chosen values; text -> a substring; range -> min/max; date -> a `DateFilterValue`. */
export type ColumnFilters = Record<
    string,
    string[] | string | RangeFilter | DateFilterValue | undefined
>;

/**
 * The column whose filter IS the screen's period (slice P1).
 *
 * ⚠️ ONE VALUE, TWO EDITORS — the `Period` control above the summary and this column's own funnel.
 * They are deliberately NOT two filters that compose: two date filters over one column would AND
 * together, so "Last 30 days" plus "Is 01-Jan" selects nothing while neither control looks wrong.
 * The page holds the value in `useOutflowPeriodStore` and surfaces it here so the table header
 * renders and edits it exactly like any other column filter.
 */
export const PERIOD_COLUMN_ID = "added_on";

/** Is this a date filter (as opposed to a facet's array, a text string or a numeric range)? */
export const isDateFilterValue = (
    filter: ColumnFilters[string]
): filter is DateFilterValue =>
    Boolean(
        filter &&
            !Array.isArray(filter) &&
            typeof filter === "object" &&
            typeof (filter as DateFilterValue).operator === "string"
    );

/**
 * How many filters the "Clear filters (N)" button would clear.
 *
 * ⚠️ THE PERIOD IS EXCLUDED, AND THE EXCLUSION IS THE POINT. It is always set (the screen opens on
 * `last 30 days`), so counting it would open every session reading "Clear filters (1)" and train
 * people to ignore the badge — and it already has a large, always-visible control of its own
 * stating exactly what it is, which is the thing a badge exists to substitute for. Clearing does
 * not touch it either: a period is the scope somebody chose for the screen, not a narrowing they
 * might have forgotten leaving on.
 */
export const activeFilterCount = (filters: ColumnFilters): number =>
    Object.entries(filters).filter(([columnId, filter]) => {
        if (columnId === PERIOD_COLUMN_ID) return false;
        if (filter == null) return false;
        if (Array.isArray(filter)) return filter.length > 0;
        if (typeof filter === "string") return filter.trim().length > 0;
        if (isDateFilterValue(filter)) return Boolean(filter.value);
        const range = filter as RangeFilter;
        return range.min != null || range.max != null;
    }).length;

// --- sorting -----------------------------------------------------------------------------------

export interface SortState {
    columnId: string | null;
    direction: "asc" | "desc";
}

// --- what the screen asks the server for (slice X3) ----------------------------------------------

/**
 * Which columns the server can facet on. Mirrors `review._FACET_COLUMNS`.
 *
 * ⚠️ `added_on` WAS REMOVED AT P1 AND MUST NOT COME BACK. It is a DATE filter now, and a date is the
 * one thing a facet cannot usefully offer: one tick box per calendar day the table touches, growing
 * without limit, and no way to express "everything after the 14th". Leaving it here was harmless
 * only by accident -- `serverQuery`'s facet loop skips it because a `DateFilterValue` is not an
 * array -- which is exactly the kind of silence that stops being true after a refactor.
 */
export const SERVER_FACET_COLUMNS: readonly string[] = [
    "beneficiary_name",
    "row_status",
    "bank_account",
    "ifsc",
    "import_batch",
];

/** Which columns the server can sort by. Mirrors `review._SORTABLE_COLUMNS`. */
export const SERVER_SORT_COLUMNS: readonly string[] = [
    "added_on",
    "amount",
    "beneficiary_name",
    "bank_reference_no",
    "row_status",
    "import_batch",
    "remarks",
];

export interface MasterTableState {
    /**
     * The tab a person clicked, in the SCREEN's vocabulary.
     *
     * ⚠️ OPTIONAL SINCE T2, AND `scope` WINS WHERE BOTH ARE GIVEN. Not every caller has a tab: the
     * Skipped dialog is fixed to one scope for its whole life and has no tab strip to read it off.
     * This is not two ways to say the same thing — a tab IMPLIES a scope through `SCOPE_FOR_TAB`,
     * which stays the one mapping between the two vocabularies. A caller with no tab simply says
     * the scope outright rather than inventing a tab it does not show.
     */
    tab?: OutflowTab;
    /** The scope in the ENDPOINT's vocabulary, for a caller that has no tab. */
    scope?: OutflowScope;
    query?: string;
    filters?: ColumnFilters;
    sort?: SortState;
    /** Zero-based. */
    page?: number;
    pageSize?: number;
    /** The import the screen is scoped to, if any. */
    batch?: string | null;
}

export interface OutflowRowsQuery {
    scope: string;
    /**
     * Split `Skipped` into the two facts it hides: `true` = the bank refused it, `false` = it was
     * skipped for any other reason, absent = both.
     *
     * ⚠️ IT EXISTS BECAUSE TWO CORRECT NUMBERS DISAGREED. The summary's Skipped chip reports 20 and
     * the `skipped` scope returns 47, because a transfer the bank REFUSED is excluded from every
     * figure the summary reports (owner ruling, option B) while still carrying `row_status`
     * `Skipped`. Nothing could ask for one group or the other until this.
     */
    failed?: boolean;
    batch?: string;
    search?: string;
    facets?: Record<string, string[]>;
    date_from?: string;
    date_to?: string;
    amount_min?: number;
    amount_max?: number;
    sort_by: string;
    sort_dir: "asc" | "desc";
    limit: number;
    offset: number;
}

export const DEFAULT_PAGE_SIZE = 50;

/**
 * The screen's state, translated into `review.get_outflow_rows` arguments.
 *
 * ⚠️ THIS IS WHERE "WHAT A FILTER MEANS" NOW LIVES, and it is the reason the client engine could be
 * deleted rather than merely bypassed. The meaning stays pure and testable in one function; the
 * application of it is SQL, in one place, over the whole table rather than one page of it.
 *
 * ⚠️ AN EMPTY FILTER IS OMITTED, NEVER SENT AS AN EMPTY VALUE. An empty facet array reaching the
 * server would be indistinguishable from a real selection in a naive handler, and the day one of
 * them treats it as "match nothing" the table blanks when you untick the last value -- which is the
 * exact bug the old client-side rule was written to avoid. Omitting is unambiguous at both ends.
 *
 * ⚠️ AN UNSORTABLE COLUMN FALLS BACK TO THE DEFAULT rather than being sent through. The Outcome
 * column is a button, and the hidden Time column is a rendering of `added_on`; neither is a sort
 * key the server knows, and a rejected sort would fail the whole page load over a cosmetic click.
 */
export const serverQuery = (state: MasterTableState): OutflowRowsQuery => {
    const filters = state.filters ?? {};
    const pageSize = state.pageSize ?? DEFAULT_PAGE_SIZE;
    const page = Math.max(0, state.page ?? 0);

    const facets: Record<string, string[]> = {};
    for (const column of SERVER_FACET_COLUMNS) {
        const chosen = filters[column];
        if (Array.isArray(chosen) && chosen.length) facets[column] = [...chosen];
    }

    const query: OutflowRowsQuery = {
        scope: state.scope ?? SCOPE_FOR_TAB[state.tab ?? DEFAULT_TAB],
        sort_by: SERVER_SORT_COLUMNS.includes(state.sort?.columnId ?? "")
            ? (state.sort!.columnId as string)
            : "added_on",
        sort_dir: state.sort?.columnId && SERVER_SORT_COLUMNS.includes(state.sort.columnId)
            ? state.sort.direction
            : "desc",
        limit: pageSize,
        offset: page * pageSize,
    };

    if (state.batch) query.batch = state.batch;

    const search = (state.query ?? "").trim();
    if (search) query.search = search;

    if (Object.keys(facets).length) query.facets = facets;

    // `remarks` and `bank_reference_no` carry a free-text filter in the same state shape. They are
    // folded into `search`, which already covers both columns server-side, rather than growing two
    // more parameters for a distinction no reader makes.
    const text = [filters.remarks, filters.bank_reference_no]
        .map((v) => String(v ?? "").trim())
        .filter(Boolean)
        .join(" ");
    if (text && !search) query.search = text;

    // ⚠️ A PSEUDO-COLUMN, handled here rather than in `_FACET_COLUMNS`, because the question is not
    // "which values of a column" but "is this row on the excluded side of an owner ruling". The
    // facet machinery answers with an IN list, which cannot express "anything that is not SUCCESS"
    // without this screen learning the bank's whole vocabulary.
    const bank = String(filters.failed ?? "").trim();
    if (bank === "failed") query.failed = true;
    if (bank === "recorded") query.failed = false;

    const amount = filters.amount as RangeFilter | undefined;
    if (amount?.min != null) query.amount_min = amount.min;
    if (amount?.max != null) query.amount_max = amount.max;

    // ⚠️ THE TIMESPAN IS RESOLVED HERE, NOT SENT AS A WORD (slice P1). Frappe's list API understands
    // "last 30 days" server-side, which is why the DataTable path can pass it through; these
    // endpoints are hand-written SQL over `added_on` and bind two plain dates. Resolving in this
    // function is the same division of labour the rest of the file follows -- `serverQuery` owns
    // what a filter MEANS, SQL owns applying it -- and it keeps the resolution pure and testable.
    //
    // ⚠️ RESOLVED AGAINST A LIVE `new Date()` ON EVERY CALL. A relative window frozen at module load
    // filters on yesterday's dates in a tab left open across midnight.
    const period = resolveDateFilter(
        isDateFilterValue(filters[PERIOD_COLUMN_ID]) ? (filters[PERIOD_COLUMN_ID] as DateFilterValue) : undefined
    );
    if (period.from) query.date_from = period.from;
    if (period.to) query.date_to = period.to;

    return query;
};

// --- the summary panel (slice X2/X3) -------------------------------------------------------------

export interface SummaryTile {
    id: string;
    label: string;
    /** Shown on hover, where a count needs a sentence to be honest. */
    hint?: string;
    count: number;
    tone: string;
}

/**
 * The status figures, in the order a reviewer reads them.
 *
 * ⚠️ THEY REPORT; THEY DO NOT SCOPE (owner ruling 2026-08-10). Each tile used to carry the
 * `statuses` it covered so a click could re-filter the table. The field is gone with the click --
 * a panel describing ONE import must not silently rewrite the filters of a table spanning all of
 * them, and it moved the tab as a side effect. Scoping lives in the Status column's own filter.
 *
 * ⚠️ THE ORDER LEADS WITH THE WORK, NOT WITH THE VOCABULARY. Matched and Mismatched come first
 * because they are what somebody has to act on; Settled and Skipped are the record of what is done.
 *
 * ⚠️ MISMATCHED IS NOW PERMANENT, AND IT USED TO BE CONDITIONAL -- the change is the whole point of
 * the 2026-08-10 merge. It was hidden at zero because it fired only when a hand-ticked payment
 * disagreed on amount beyond the settle window, so it was 0 on almost every import and a standing
 * "0 Mismatched" chip would have trained people to stop reading the row it sits in. Having absorbed
 * `Unmatched` it is the PRODUCTIVE figure -- most of a statement's work -- and at zero it says the
 * genuinely useful thing: this import is finished finding work. Only `Error` stays conditional,
 * because it still means the software failed and that is still rare.
 */
export const summaryTiles = (totals: {
    matched_rows: number;
    mismatched_rows: number;
    settled_rows: number;
    skipped_rows: number;
    pending_rows: number;
    error_rows: number;
    failed_rows?: number;
}): SummaryTile[] => {
    const tiles: SummaryTile[] = [
        {
            id: "matched",
            label: "Matched",
            count: totals.matched_rows,
            tone: "border-sky-200 bg-sky-50 text-sky-900",
        },
        {
            // ⚠️ THE ID STAYS `mismatched` — it keys the chip and mirrors the stored status. Only
            // the LABEL changed (see `rowStatusLabel`): 133 of 133 rows under this chip were the
            // found-nothing case, so the word "Mismatched" sent readers hunting for a mismatch that
            // was not there. The label is the one place to change it; the vocabulary is unmoved.
            id: "mismatched",
            label: rowStatusLabel(ROW_MISMATCHED),
            count: totals.mismatched_rows,
            tone: "border-amber-200 bg-amber-50 text-amber-900",
        },
        {
            id: "settled",
            label: "Settled",
            count: totals.settled_rows,
            tone: "border-emerald-200 bg-emerald-50 text-emerald-900",
        },
        {
            // ⚠️ THE ONE CHIP WHOSE COUNT IS NOT ITS `*_rows` FIGURE, and the exception is
            // deliberate (owner, 2026-08-11). `skipped_rows` is 20 because a transfer the bank
            // REFUSED is money that never left the account and is excluded from every figure the
            // summary reports (option B). But `row_status` is `Skipped` on all 47, so the dialog
            // this chip opens holds 47 — and a chip reading 20 that opens a list of 47 reads as a
            // bug however right both numbers are.
            //
            // ⚠️ THE ACCEPTED COST, STATED SO IT IS NOT REDISCOVERED AS A DEFECT: the four chips now
            // sum to more than "N successful transfers" by exactly the failed count. Invariant 13
            // avoided that by keeping the chip at 20; the owner has taken the other side, on the
            // grounds that the chip is a door and must be labelled with what is behind it. `hint`
            // carries the split so the reader can reconcile it without arithmetic, and the panel's
            // failed footnote still names the money.
            //
            // ⚠️ ONLY THE RENDERED COUNT MOVED. `derive_import_summary` is UNTOUCHED --
            // `skipped_rows` is still 20 everywhere else, so nothing that computes with it shifted.
            id: "skipped",
            label: "Skipped",
            count: totals.skipped_rows + (totals.failed_rows ?? 0),
            hint: totals.failed_rows
                ? `${totals.skipped_rows} already recorded as Paid by hand · ${totals.failed_rows} refused by the bank, which are left out of every figure above`
                : undefined,
            tone: "border-muted bg-muted/50 text-muted-foreground",
        },
    ];

    if (totals.pending_rows > 0) {
        tiles.unshift({
            id: "pending",
            label: "Not matched yet",
            count: totals.pending_rows,
            tone: "border-muted bg-muted/50 text-muted-foreground",
        });
    }
    if (totals.error_rows > 0) {
        tiles.push({
            id: "error",
            label: "Errors",
            count: totals.error_rows,
            tone: "border-rose-300 bg-rose-100 text-rose-900",
        });
    }
    return tiles;
};

/**
 * One import, as `get_outflow_summary` reports it for the current period (slice P1).
 *
 * `row_count` is how many of its rows are IN the period; `total_rows` is how many it holds
 * altogether. The two differ whenever a statement straddles the window, and that difference is what
 * the re-match warning is about.
 */
export interface SummaryImport {
    name: string;
    original_filename?: string;
    period_from?: string;
    period_to?: string;
    uploaded_at?: string;
    row_count: number;
    total_rows: number;
}

/** "3 imports" / "1 import" / "" — the caption beside the period control. */
export const importsCoveredLabel = (imports: readonly SummaryImport[]): string => {
    if (!imports.length) return "";
    return `${imports.length} import${imports.length === 1 ? "" : "s"}`;
};

/**
 * What "Re-run match" will actually touch, in a sentence.
 *
 * ⚠️ IT MUST NAME THE OVERSPILL, AND THAT IS THE WHOLE REASON IT EXISTS. Matching runs per BATCH --
 * `match_batch` has four global passes that reason over a whole import at once, so matching "only
 * the rows in the period" would hand them a partial picture and break claims and stacks. The
 * consequence is that a statement straddling the window is re-matched IN FULL. That is wider than
 * the period implies, so the screen says so before the click rather than after it.
 *
 * ⚠️ IT COMPARES `row_count` TO `total_rows` RATHER THAN COMPARING DATES. Whether a batch straddles
 * the window is already answered exactly by "are all of its rows in scope?", and the server computed
 * both numbers from the same query. Re-deriving it from `period_from`/`period_to` would be asking a
 * different question -- a batch's DECLARED period is not a fact about where its rows fall.
 */
export const rematchWarning = (imports: readonly SummaryImport[]): string => {
    if (!imports.length) return "No imports in this period.";

    const straddling = imports.filter((b) => b.total_rows > b.row_count);
    const names = imports
        .slice(0, 3)
        .map((b) => b.original_filename || b.name)
        .join(", ");
    const more = imports.length > 3 ? ` and ${imports.length - 3} more` : "";

    const base = `Re-runs the match for ${imports.length} import${
        imports.length === 1 ? "" : "s"
    }: ${names}${more}.`;

    if (!straddling.length) return base;

    const spill = straddling.reduce((sum, b) => sum + (b.total_rows - b.row_count), 0);
    // ⚠️ "1 of them extend" WAS THE SHIPPED WORDING AND IT READ AS BROKEN, which matters on a
    // sentence whose whole job is to warn that a button reaches further than it looks. With a single
    // import "1 of them" is also clumsy for a set of one -- so the SUBJECT and the VERB are chosen
    // separately rather than pluralised together.
    const subject = imports.length === 1 ? "It" : `${straddling.length} of them`;
    const verb = straddling.length === 1 ? "extends" : "extend";
    return `${base} ${subject} ${verb} past this period, so ${spill} transfer${
        spill === 1 ? "" : "s"
    } outside it will be re-matched too — matching always runs over a whole statement.`;
};

/**
 * How one import reads in a picker.
 *
 * ⚠️ NEVER THE BATCH ID ALONE. `OFI-26-00007` means nothing to an accountant; the file they
 * uploaded and the fortnight it covers is how they know which statement is which. The id is the
 * last-resort fallback for a row missing both.
 *
 * ⚠️ THE SUMMARY PANEL'S PICKER IS GONE (slice P1) BUT THIS IS STILL USED -- the import dialog and
 * the deep-linked header both name a statement this way, and the label is the same either way.
 */
export const importOptionLabel = (option: {
    name: string;
    original_filename?: string;
    period_from?: string;
    period_to?: string;
}): string => {
    const file = (option.original_filename ?? "").trim();
    // ⚠️ `dd-MMM-yyyy`, THE APP-WIDE DATE FORMAT, NOT THE RAW ISO `dateOnly` RETURNS. This label sits
    // directly above a metadata line already rendering `02-May-2026`, so the ISO form read as two
    // different date conventions on one panel. `dateOnly` itself must stay ISO -- it also feeds the
    // Payment Date column's sort value, where a `dd-MMM-yyyy` string would order by day-of-month.
    const from = formatIfPresent(option.period_from);
    const to = formatIfPresent(option.period_to);
    const period = from && to ? `${from} → ${to}` : from || to || "";
    if (file && period) return `${file} · ${period}`;
    return file || period || option.name;
};

// --- confirm all matched (slice X5) --------------------------------------------------------------

/**
 * One row of `review.get_confirmable_rows`.
 *
 * The target fields are absent on a `needs_you` row -- a row that matched SEVERAL approved records
 * has no single one to name, which is exactly why it cannot be bulk-confirmed.
 */
export interface ConfirmableRow {
    name: string;
    added_on?: string;
    amount: number;
    beneficiary_name?: string;
    remarks?: string;
    bank_reference_no?: string;
    outcome_note?: string;
    target_doctype?: string;
    target_name?: string;
    target_amount?: number;
    target_status?: string;
    vendor_name?: string | null;
    project_name?: string | null;
    /** Bank amount minus the record's. Signed. */
    amount_delta?: number;
    /** Whether confirming will REWRITE the record's amount (slice X1). */
    amount_changes?: boolean;
    /**
     * The order the record is against. ⚠️ NOT ALWAYS A PO — 602 `Procurement Orders` against 193
     * `Service Requests` on the first real statement, and two of the three ledgers carry none at
     * all. The type travels with the id because the id alone cannot say which it is.
     */
    order_doctype?: string | null;
    order_name?: string | null;
    /**
     * WHY this record was pre-selected, when it was not simply the only approved candidate.
     * Blank is the ordinary case and carries no doubt. See `SUGGESTION_RULE_LABELS`.
     */
    suggestion_rule?: string | null;
    /** How the counterpart was FOUND — the matcher tier. See `MATCH_BASIS_LABELS`. */
    match_basis?: string | null;
    /** Whether the machine chose this record. Exactly "there is a suggestion". */
    auto_matched?: boolean;
}

// --- how a record was pre-selected (mirrors services/outflow_import/disambiguate.RULE_LABELS) ----

/**
 * ⚠️ A MIRROR, AND THE BACKEND IS THE AUTHORITY — same standing as `outflowImportStatus.ts`.
 * An id the server sends that is missing here renders as the raw id rather than as nothing, so a
 * new rule shipped server-side degrades to something truthful instead of an empty chip that reads
 * as "no rule" — the exact opposite of what it would mean.
 */
export const SUGGESTION_RULE_LABELS: Record<string, string> = {
    sole: "Only candidate",
    "stack-pairing": "Identical set, paired arbitrarily",
    "project-in-remark": "Remark named the project",
    "nearest-amount": "Nearest amount",
    interchangeable: "Interchangeable records",
};

/**
 * Rules where the machine chose between records that the evidence could NOT separate.
 *
 * ⚠️ THIS IS THE SET A REVIEWER SHOULD LOOK AT, and it is not the same as "a rule fired". Both
 * members pick deterministically from things nothing distinguishes — `stack-pairing` zips identical
 * transfers against identical records, `interchangeable` takes the first of a set that agrees on
 * project and amount to the paise. `sole` had no choice to make; the other two acted on evidence.
 * Grouping all five as "a rule" would bury the two that are arbitrary among three that are not.
 */
export const ARBITRARY_SUGGESTION_RULES: ReadonlySet<string> = new Set([
    "stack-pairing",
    "interchangeable",
]);

/** How the counterpart was FOUND — the matcher tier, as a person reads it. */
export const MATCH_BASIS_LABELS: Record<string, string> = {
    reference: "Bank reference matched",
    "account+IFSC": "Vendor bank account",
    "project in remark": "Amount + project in remark",
};

export const matchBasisLabel = (basis?: string | null): string => {
    const id = (basis || "").trim();
    if (!id) return "";
    return MATCH_BASIS_LABELS[id] || id;
};

export const suggestionRuleLabel = (rule?: string | null): string => {
    const id = (rule || "").trim();
    if (!id) return "";
    return SUGGESTION_RULE_LABELS[id] || id;
};

/**
 * The order a record is against, as a person reads it.
 *
 * ⚠️ IT NEVER SAYS "PO" UNLESS IT IS ONE. A quarter of the payments on a real statement are against
 * a Service Request, and the whole reason the type travels beside the id is that the id cannot say
 * so — `SR-00097-000845` and `PO/082/00103/26-27` happen to look different, but nothing guarantees
 * that, and a screen must not be reading id formats to decide what to call something.
 */
export const orderLabel = (row: {
    order_doctype?: string | null;
    order_name?: string | null;
}): { kind: string; name: string } | null => {
    const name = (row.order_name || "").trim();
    if (!name) return null;
    const doctype = (row.order_doctype || "").trim();
    const kind =
        doctype === "Procurement Orders"
            ? "PO"
            : doctype === "Service Requests"
              ? "SR"
              : doctype || "Order";
    return { kind, name };
};

// --- the confirm rollup: vendor -> project -> transfer (slice S4) --------------------------------

const NO_VENDOR = "(no vendor)";
const NO_PROJECT = "(no project)";

export interface ConfirmProjectNode {
    key: string;
    project: string;
    rows: ConfirmableRow[];
    value: number;
}

export interface ConfirmVendorNode {
    key: string;
    vendor: string;
    projects: ConfirmProjectNode[];
    /** Every row under this vendor, in project order. The selection algebra works on these. */
    rows: ConfirmableRow[];
    value: number;
    /**
     * ⚠️ THE COLLAPSE, AND IT IS DRIVEN BY MEASUREMENT RATHER THAN TASTE. 147 of 210 vendors on the
     * first real statement sit on exactly ONE project, and 79 have exactly one transfer. A level
     * that almost always holds a single child is not a rollup, it is a click — you expand a vendor,
     * see one project, and expand again to reach the rows. When there is one project its name reads
     * INLINE on the vendor row (`soleProject`) and the level is not rendered at all; when there are
     * two or more it is rendered, because then it carries information.
     */
    soleProject: string | null;
}

const rowVendor = (row: ConfirmableRow): string =>
    (row.vendor_name || "").trim() || NO_VENDOR;

const rowProject = (row: ConfirmableRow): string =>
    (row.project_name || "").trim() || NO_PROJECT;

/**
 * Group the ready rows into the tree the confirm dialog renders.
 *
 * ⚠️ THE VALUE AT EVERY LEVEL IS THE BANK'S AMOUNT, NEVER THE RECORD'S. What the button writes is
 * the transfer — since X1 a confirm rewrites the record's figure to the bank's whenever they differ,
 * so totalling the records would report the amount that is about to be replaced.
 *
 * Ordering is by value, largest first, at both levels: a reviewer scanning for what matters reads
 * down, and money is what makes a branch matter. Ties break on the name so the order is stable
 * across renders and refetches — the same guarantee `pair_stack` gives its sides, for the same
 * reason: a branch that reshuffles under a half-made selection is a screen you cannot trust.
 */
export function buildConfirmTree(rows: ConfirmableRow[]): ConfirmVendorNode[] {
    const byVendor = new Map<string, Map<string, ConfirmableRow[]>>();

    for (const row of rows) {
        const vendor = rowVendor(row);
        const project = rowProject(row);
        let projects = byVendor.get(vendor);
        if (!projects) {
            projects = new Map();
            byVendor.set(vendor, projects);
        }
        const bucket = projects.get(project);
        if (bucket) bucket.push(row);
        else projects.set(project, [row]);
    }

    const sum = (list: ConfirmableRow[]) => list.reduce((n, r) => n + (r.amount || 0), 0);

    const vendors: ConfirmVendorNode[] = [];
    for (const [vendor, projects] of byVendor) {
        const projectNodes: ConfirmProjectNode[] = [];
        for (const [project, list] of projects) {
            projectNodes.push({
                key: `${vendor}\u0000${project}`,
                project,
                rows: list,
                value: sum(list),
            });
        }
        projectNodes.sort((a, b) => b.value - a.value || a.project.localeCompare(b.project));

        const flat = projectNodes.flatMap((p) => p.rows);
        vendors.push({
            key: vendor,
            vendor,
            projects: projectNodes,
            rows: flat,
            value: sum(flat),
            soleProject: projectNodes.length === 1 ? projectNodes[0].project : null,
        });
    }

    vendors.sort((a, b) => b.value - a.value || a.vendor.localeCompare(b.vendor));
    return vendors;
}

export type NodeSelection = "none" | "some" | "all";

/**
 * Checked, indeterminate, or unchecked — DERIVED from the leaves, never stored.
 *
 * ⚠️ A STORED PARENT STATE IS THE CLASSIC TREE BUG. It goes stale the moment a leaf changes by any
 * route other than clicking that parent — a filter, a refetch, a single leaf toggled underneath it —
 * and then a vendor reads "checked" while one of its transfers is not going to be confirmed. Here
 * the parent has no state of its own to go stale.
 */
export function nodeSelectionState(
    rows: ConfirmableRow[],
    selected: ReadonlySet<string>
): NodeSelection {
    if (!rows.length) return "none";
    let hits = 0;
    for (const row of rows) if (selected.has(row.name)) hits += 1;
    if (hits === 0) return "none";
    return hits === rows.length ? "all" : "some";
}

/**
 * Toggle every row under a node. Returns a NEW set.
 *
 * ⚠️ "SOME" TOGGLES TO ALL, NOT TO NONE. A half-selected branch that a reviewer clicks is one they
 * are reaching toward, not away from; emptying it would throw away the picks they already made.
 * ⚠️ IT ONLY EVER TOUCHES THE ROWS IT IS GIVEN, which is what makes filtering safe: the caller
 * passes the VISIBLE rows of the node, so a select-all under a search can never quietly tick rows
 * the search is hiding.
 */
export function toggleNode(
    rows: ConfirmableRow[],
    selected: ReadonlySet<string>
): Set<string> {
    const next = new Set(selected);
    const state = nodeSelectionState(rows, selected);
    if (state === "all") for (const row of rows) next.delete(row.name);
    else for (const row of rows) next.add(row.name);
    return next;
}

export interface ConfirmSummary {
    transfers: number;
    vendors: number;
    projects: number;
    value: number;
    /** How many confirms will REWRITE an approved figure (X1). 312 of 807 on the real statement. */
    amountsChanging: number;
    /** Selected rows the current filter is not showing. */
    hidden: number;
}

/**
 * What pressing the button will actually do.
 *
 * ⚠️ IT COUNTS OVER THE SELECTION, NOT OVER THE VISIBLE TREE, and the two differ the moment anyone
 * types in the search box. Selection is a set of row names and deliberately SURVIVES filtering — so
 * without `hidden` a reviewer could filter to one vendor, read "12 transfers", and confirm 142.
 *
 * ⚠️ `amountsChanging` IS THE FIGURE THAT EXISTS NOWHERE ELSE ON THE SCREEN. Since X1 a confirm
 * rewrites the record's amount whenever the bank disagrees; at this scale that is hundreds of silent
 * corrections to approved figures. A reviewer authorising them is entitled to see how many.
 */
export function confirmSelectionSummary(
    all: ConfirmableRow[],
    visible: ConfirmableRow[],
    selected: ReadonlySet<string>
): ConfirmSummary {
    const visibleNames = new Set(visible.map((r) => r.name));
    const vendors = new Set<string>();
    const projects = new Set<string>();
    let transfers = 0;
    let value = 0;
    let amountsChanging = 0;
    let hidden = 0;

    for (const row of all) {
        if (!selected.has(row.name)) continue;
        transfers += 1;
        value += row.amount || 0;
        vendors.add(rowVendor(row));
        projects.add(`${rowVendor(row)}\u0000${rowProject(row)}`);
        if (row.amount_changes) amountsChanging += 1;
        if (!visibleNames.has(row.name)) hidden += 1;
    }

    return {
        transfers,
        vendors: vendors.size,
        projects: projects.size,
        value,
        amountsChanging,
        hidden,
    };
}

export interface ConfirmFilters {
    search: string;
    /** `""` = every ledger. */
    ledger: string;
    /** `""` = any, `"rule"` = picked by an Option B rule, `"sole"` = the only candidate. */
    pickedBy: string;
    /** Only rows whose confirm will rewrite an approved amount. */
    changesOnly: boolean;
}

export const EMPTY_CONFIRM_FILTERS: ConfirmFilters = {
    search: "",
    ledger: "",
    pickedBy: "",
    changesOnly: false,
};

/**
 * Which rows survive the search box and the facets.
 *
 * ⚠️ IT FILTERS ROWS, AND THE TREE IS REBUILT FROM WHAT SURVIVES. Filtering the TREE instead —
 * keeping a vendor because its own name matched — would show a vendor node whose leaves do not
 * match, and its "54 transfers" would then describe rows the dialog is not displaying. Rebuilding
 * from the surviving rows makes every count on every node true by construction.
 *
 * The search spans what a person would actually type to find a branch: the vendor, the project, the
 * order number, the record id, the beneficiary as the bank spelled it, and the bank reference.
 */
export function filterConfirmRows(
    rows: ConfirmableRow[],
    filters: ConfirmFilters
): ConfirmableRow[] {
    const needle = (filters.search || "").trim().toLowerCase();
    const ledger = (filters.ledger || "").trim();
    const pickedBy = (filters.pickedBy || "").trim();

    return rows.filter((row) => {
        if (ledger && (row.target_doctype || "") !== ledger) return false;

        if (pickedBy) {
            const rule = (row.suggestion_rule || "").trim();
            // ⚠️ `sole` IS NOW A STORED VALUE, not the absence of one. Before T1 a blank meant both
            // "only candidate" and "chosen by the stack pass", so this filter showed 112 arbitrary
            // pairings under Only candidate.
            if (pickedBy === "rule" && (!rule || rule === "sole")) return false;
            if (pickedBy === "arbitrary" && !ARBITRARY_SUGGESTION_RULES.has(rule)) return false;
            if (pickedBy !== "rule" && pickedBy !== "arbitrary" && rule !== pickedBy) return false;
        }

        if (filters.changesOnly && !row.amount_changes) return false;

        if (!needle) return true;
        const hay = [
            row.vendor_name,
            row.project_name,
            row.order_name,
            row.target_name,
            row.beneficiary_name,
            row.bank_reference_no,
        ]
            .map((v) => (v || "").toLowerCase())
            .join(" ");
        return hay.includes(needle);
    });
}

/** How many active narrowings the confirm dialog is under, for the "clear" affordance. */
export const confirmFilterCount = (filters: ConfirmFilters): number =>
    (filters.search.trim() ? 1 : 0) +
    (filters.ledger ? 1 : 0) +
    (filters.pickedBy ? 1 : 0) +
    (filters.changesOnly ? 1 : 0);

export interface ConfirmOutcome {
    row: ConfirmableRow;
    ok: boolean;
    error?: string;
}

/**
 * The three buckets `review.get_confirmable_rows` returns, reconciled into what the dialog says.
 *
 * ⚠️ THIS EXISTS BECAUSE TWO SCREENS REPORTED DIFFERENT NUMBERS WITH NOTHING EXPLAINING THE GAP.
 * The summary panel's button reads `confirmable_rows`, which counts `Matched` rows carrying a
 * suggestion WITHOUT checking that the suggested record still exists. The dialog checks. So a row
 * whose record was deleted since the match ran is inside the button's count and outside the
 * dialog's list, and the two disagreed silently -- 688 on one, fewer on the other.
 *
 * The fix is not to force them equal; they measure different things and should not be. It is to
 * make the funnel STATEABLE, which is what this returns.
 */
export interface ConfirmFunnel {
    /** `Matched` rows in this import -- the widest number the dialog talks about. */
    matched: number;
    /** What the summary panel's button counts: rows carrying a suggestion. `ready + stale`. */
    confirmable: number;
    /** Rows whose suggested record resolves and can be confirmed right now. */
    ready: number;
    /** Rows the matcher found SEVERAL records for, so it deliberately picked none. */
    needsYou: number;
    /** Rows whose suggested record has been deleted since the match ran. */
    stale: number;
}

export const confirmFunnel = (payload?: {
    matched_rows?: number;
    ready?: unknown[];
    needs_you?: unknown[];
    stale?: unknown[];
}): ConfirmFunnel => {
    const ready = payload?.ready?.length ?? 0;
    const needsYou = payload?.needs_you?.length ?? 0;
    const stale = payload?.stale?.length ?? 0;
    return {
        // Fall back to the sum rather than 0 when the server predates `matched_rows`: an absent
        // total should read as "all of them", never as "there are none".
        matched: payload?.matched_rows ?? ready + needsYou + stale,
        confirmable: ready + stale,
        ready,
        needsYou,
        stale,
    };
};

// --- error messages ------------------------------------------------------------------------------

/**
 * The real reason a Frappe call failed, dug out of the envelope it arrives in.
 *
 * ⚠️ `err.message` IS USUALLY THE USELESS ONE. Frappe answers a `frappe.throw` with HTTP 417 and a
 * body whose `message` is the literal string **"There was an error."** -- the actual sentence, the
 * one the endpoint wrote, is inside `_server_messages`: a JSON array of JSON strings, each an object
 * with `message` and often `title`. Every call site in this feature read `err?.message`, so every
 * failure in the confirm dialog rendered as "There was an error." and a live 1-row confirm failure
 * could not be diagnosed from the screen at all (2026-08-10, browser walk).
 *
 * Order is deliberate, most specific first:
 *   1. `_server_messages`  -- what the endpoint deliberately said. Titles included when they add
 *      something the message does not already say.
 *   2. `exception`         -- an UNCAUGHT error. Nobody wrote this for a reader, but the exception
 *      class and its text beat a generic string, and this is the case where a stack trace is
 *      waiting in the Error Log for whoever reads this.
 *   3. `message`           -- only when it is not the generic placeholder.
 *   4. the HTTP status     -- last resort, and it still says something (417 vs 403 vs 500 tells a
 *      reader whether to look at the rule, the permission, or the log).
 *
 * Returns a single line. `fallback` names the ACTION for the case where the envelope is empty, so
 * the reader at least knows what failed rather than only that something did.
 */
export const describeFrappeError = (err: unknown, fallback = "The request failed."): string => {
    const e = (err ?? {}) as Record<string, any>;

    const serverMessages = parseServerMessages(e._server_messages);
    if (serverMessages.length) return serverMessages.join(" ");

    const exception = typeof e.exception === "string" ? e.exception.trim() : "";
    if (exception) {
        // `frappe.exceptions.ValidationError: the real text` -- keep the class, it is the only
        // signal of WHICH rule fired when the text is terse.
        const [, cls, text] = exception.match(/^([\w.]+Error):\s*([\s\S]+)$/) ?? [];
        if (cls && text) return `${cls.split(".").pop()}: ${collapse(text)}`;
        return collapse(exception);
    }

    const message = typeof e.message === "string" ? e.message.trim() : "";
    if (message && message !== GENERIC_FRAPPE_MESSAGE) return collapse(message);

    const status = e.httpStatus ? ` (HTTP ${e.httpStatus}${e.httpStatusText ? ` ${e.httpStatusText}` : ""})` : "";
    return `${fallback}${status}`;
};

/** Frappe's placeholder for "a `frappe.throw` happened, look in `_server_messages`". */
const GENERIC_FRAPPE_MESSAGE = "There was an error.";

const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * `_server_messages` is a JSON array of JSON STRINGS -- double-encoded, and each element may be a
 * bare string rather than an object. Every branch below has been seen in this app.
 */
const parseServerMessages = (raw: unknown): string[] => {
    if (typeof raw !== "string" || !raw.trim()) return [];
    let list: unknown;
    try {
        list = JSON.parse(raw);
    } catch {
        return [];
    }
    if (!Array.isArray(list)) return [];

    return list
        .map((entry) => {
            let item: any = entry;
            if (typeof item === "string") {
                try {
                    item = JSON.parse(item);
                } catch {
                    return collapse(stripTags(item));
                }
            }
            if (item && typeof item === "object") {
                const message = collapse(stripTags(String(item.message ?? "")));
                const title = collapse(stripTags(String(item.title ?? "")));
                if (!message) return title;
                // A title that merely repeats the message adds nothing; one that classifies it
                // ("Already settled", "Amounts differ") is often the most useful word on screen.
                return title && !message.toLowerCase().startsWith(title.toLowerCase())
                    ? `${title}: ${message}`
                    : message;
            }
            return "";
        })
        .filter(Boolean);
};

/** Frappe messages carry HTML (`<br>`, `<b>`); these render as text, not markup. */
const stripTags = (text: string) => text.replace(/<[^>]*>/g, " ");

// --- the import preview (slice X4) ---------------------------------------------------------------

/**
 * What actually left the bank, as a bank statement's own summary block states it.
 *
 * ⚠️ THE TWO FIGURES FOOT, AND SHOWING THEM SEPARATELY WITHOUT THE TOTAL HID THAT. `gross` is the
 * beneficiary money on SUCCESSFUL transfers; `charges` is the gateway fee and its tax across EVERY
 * transfer, because the bank takes its fee whatever the transfer's outcome (see `parser.py`). Their
 * sum is the debit the accountant reconciles against the account, and it was the one number this
 * dialog never showed.
 *
 * ⚠️ FAILED TRANSFERS ARE ALREADY OUT OF `gross` -- the server excludes them at parse time, and has
 * since before the 2026-08-10 ruling that took them out of the post-import figures too. Do NOT
 * subtract them again here; that would deduct the same money twice.
 */
export interface StatementDebit {
    gross: number;
    charges: number;
    total: number;
}

export const statementDebit = (preview: {
    gross_amount?: number;
    charges_amount?: number;
}): StatementDebit => {
    const gross = preview.gross_amount ?? 0;
    const charges = preview.charges_amount ?? 0;
    return { gross, charges, total: gross + charges };
};

/**
 * The transfer counts the preview states, with the two exclusions named separately.
 *
 * ⚠️ THERE IS DELIBERATELY NO COMBINED "how many will I actually work on" FIGURE. The two
 * exclusions -- failed at the bank, already in an earlier import -- are counted on different axes
 * and can OVERLAP: a transfer that failed may also be a duplicate. The server reports each axis
 * alone, so any client-side combination would be a guess (`total - failed - duplicates`
 * double-subtracts the overlap; `min(new, successful)` is a bound, not a count).
 *
 * Naming a guess as a count is how a confirm button ends up promising a number the import then
 * misses. Both exclusions are shown; the arithmetic is left to the reader, who can see both.
 */
export interface PreviewCounts {
    total: number;
    successful: number;
    failed: number;
    duplicates: number;
    /** New on the DUPLICATE axis only -- the server's own figure, which the confirm button uses. */
    newRows: number;
}

export const previewCounts = (preview: {
    total_rows?: number;
    successful_rows?: number;
    failed_rows?: number;
    duplicate_rows?: number;
    new_rows?: number;
}): PreviewCounts => {
    const total = preview.total_rows ?? 0;
    const failed = preview.failed_rows ?? 0;
    return {
        total,
        successful: preview.successful_rows ?? Math.max(total - failed, 0),
        failed,
        duplicates: preview.duplicate_rows ?? 0,
        newRows: preview.new_rows ?? total,
    };
};

// --- what counts as decided --------------------------------------------------------------------

/**
 * Whether a row carries a decision that could be confirmed right now.
 *
 * ⚠️ A ROW THE MATCH HAS NOT RUN ON IS NEVER CONFIRMABLE, whatever decision is attached to it.
 * `Pending match run` means nothing has been looked up, so any decision on it was made against no
 * evidence at all.
 */
export const isConfirmable = (
    row: OutflowImportRow,
    decision: RowDecision | undefined
): boolean => {
    if (!OPEN_ROW_STATUSES.has(row.row_status)) return false;
    if (row.row_status === "Pending match run") return false;
    if (!decision) return false;
    if (decision.target === "new") {
        const form = decision.newExpense;
        if (!form?.doctype || !form.expenseType) return false;
        if (form.doctype === "Project Expenses" && !form.project) return false;
        return true;
    }
    // ⚠️ BOTH, not just the link. The ledger now arrives with the chosen record rather than from a
    // card clicked beforehand, so a link with no target is a half-written decision -- and
    // `settle_row` would be called with an undefined doctype.
    return Boolean(decision.target && decision.linkTo);
};

/**
 * How many of the selected rows are actually decided.
 *
 * ⚠️ THE BULK BAR REPORTS THIS, NOT THE SELECTION SIZE (owner ruling): "Confirm 4 decided" when 5
 * are ticked. It must never silently act on a row nobody resolved -- and it must not refuse the
 * whole action either, because the other four are ready.
 */
export const countDecided = (
    rows: OutflowImportRow[],
    selected: ReadonlySet<string>,
    decisions: ReadonlyMap<string, RowDecision>
): number =>
    rows.filter((row) => selected.has(row.name) && isConfirmable(row, decisions.get(row.name)))
        .length;

export const decidedRows = (
    rows: OutflowImportRow[],
    selected: ReadonlySet<string>,
    decisions: ReadonlyMap<string, RowDecision>
): OutflowImportRow[] =>
    rows.filter((row) => selected.has(row.name) && isConfirmable(row, decisions.get(row.name)));

// --- where a settled or suggested record lives ---------------------------------------------------

/**
 * A link from an import row to the record it settles.
 *
 * `exact` is the honest half. A payment link lands ON the record; an expense link can only reach the
 * list it lives in, because neither expense table has the record id among its searchable fields. The
 * screen renders the two differently rather than implying a precision it does not have.
 */
export interface SettlementLink {
    href: string;
    label: string;
    exact: boolean;
    /**
     * The tooltip.
     *
     * ⚠️ BUILT BESIDE THE `href`, ON PURPOSE. Written in the component it immediately went stale --
     * it named "Payments Done" on a link that had been redirected to "All Payments", which is the
     * one kind of wrong a tooltip can be: confidently specific. Same value, same function, one place.
     */
    title: string;
}

/**
 * Where to send someone who wants to see the record behind a matched or settled row.
 *
 * ⚠️ THE PAYMENT URL IS NOT BUILT HERE. It comes from `paymentHref`, which the Project Payments
 * module owns along with the table's URL-sync key format -- the deep link works by pre-seeding that
 * table's own search params, so the two have to agree. A copy of the format in this file would keep
 * working until the payments module changed, then fail SILENTLY by landing on an unfiltered table.
 *
 * ⚠️ EXPENSES CANNOT BE DEEP-LINKED TO A ROW, and that is a property of their tables, not an
 * omission here: `PE_SEARCHABLE_FIELDS` and `NPE_SEARCHABLE_FIELDS` cover description, type, vendor
 * and amount -- never the record id. Adding the id to either list is what would make `exact` true.
 */
export const settlementLink = (
    targetDoctype: string | undefined | null,
    targetName: string | undefined | null,
    /**
     * Whether this row has already been SETTLED, which is what makes the payment `Paid`.
     *
     * ⚠️ NOT COSMETIC. "Payments Done" filters `status = Paid`, so a merely SUGGESTED payment --
     * still `Approved` until someone confirms -- lands there on an empty table, with nothing on
     * screen explaining why. Verified live. An unsettled record goes to "All Payments" instead.
     */
    settled = false
): SettlementLink | null => {
    const doctype = (targetDoctype ?? "").trim();
    const name = (targetName ?? "").trim();
    if (!doctype || !name) return null;

    if (doctype === "Project Payments") {
        const tab = settled ? "Payments Done" : "All Payments";
        return {
            href: paymentHref(name, settled),
            label: name,
            exact: true,
            title: `Open ${name} in Project Payments → ${tab}`,
        };
    }
    if (doctype === "Project Expenses" || doctype === "Non Project Expenses") {
        const isProject = doctype === "Project Expenses";
        return {
            href: isProject ? "/expense/project" : "/expense/non-project",
            label: name,
            exact: false,
            title: `Open ${isProject ? "Project" : "Non Project"} Expenses — ${name} cannot be linked to directly`,
        };
    }
    return null;
};

/**
 * Every record an import row points at, as links.
 *
 * ⚠️ A SETTLED ROW READS ITS `matches`, NOT ITS NOTE. `Outflow Row Match` records what a row
 * actually settled; the note is a sentence written for a person and parsing it back out would be
 * guessing at the very fact the table already stores exactly. A MATCHED row has no match record yet
 * -- nothing has been written -- so it falls back to the match run's stored suggestion.
 */
export const rowSettlementLinks = (row: OutflowImportRow): SettlementLink[] => {
    // A match record means WE wrote the money, so its payment is Paid -> "Payments Done".
    const settled = (row.matches ?? [])
        .map((m) => settlementLink(m.target_doctype, m.target_name, true))
        .filter((link): link is SettlementLink => link !== null);
    if (settled.length) return settled;

    // An already-recorded duplicate: SOMEBODY ELSE ticked it Paid before this statement was
    // uploaded. We settled nothing, but the payment is Paid all the same -> "Payments Done".
    // This is the only route to a link on a Skipped or Mismatched row, whose note names the
    // payment in prose and which carries neither a match record nor a suggestion.
    const alreadyPaid = (row.related_payments ?? [])
        .map((p) => settlementLink(p.target_doctype, p.target_name, true))
        .filter((link): link is SettlementLink => link !== null);
    if (alreadyPaid.length) return alreadyPaid;

    // A suggestion has settled nothing, so its payment is still Approved -> "All Payments".
    const suggested = settlementLink(row.suggested_doctype, row.suggested_name, false);
    return suggested ? [suggested] : [];
};

// --- what the match run already picked -----------------------------------------------------------

/** The three ledgers a stored suggestion may address. Anything else is not a target we can settle. */
const SETTLEABLE_TARGETS: readonly string[] = [
    "Project Payments",
    "Project Expenses",
    "Non Project Expenses",
];

/**
 * The match run's own pick for this row, as a decision, or `null`.
 *
 * ⚠️ THE SERVER DECIDES WHETHER THERE IS ONE; THIS ONLY READS IT. `sole_suggestion` in
 * `services/outflow_import/status.py` owns the "exactly one approved candidate, or nothing" rule --
 * two candidates, a fan-out, a skipped duplicate and an unmatched row all arrive here blank. A
 * second copy of that rule in the browser is precisely what this replaced: the dialog used to
 * re-derive its own pre-selection from a DIFFERENT candidate list than the row's note counted, so a
 * row could read "One approved record at this amount" and still refuse to tick it.
 *
 * The status guards are belt-and-braces over a server that already blanks those rows -- but a
 * suggestion rendered as ready-to-confirm on a row nobody may settle is bad enough to check twice.
 */
export const suggestedDecision = (row: OutflowImportRow): RowDecision | null => {
    const target = (row.suggested_doctype ?? "").trim();
    const linkTo = (row.suggested_name ?? "").trim();
    if (!target || !linkTo) return null;
    if (!SETTLEABLE_TARGETS.includes(target)) return null;
    if (!OPEN_ROW_STATUSES.has(row.row_status)) return null;
    if (row.row_status === ROW_PENDING_MATCH) return null;
    return { target: target as DecisionTarget, linkTo };
};

/**
 * Fold every row's stored suggestion into the decisions the reviewer is holding.
 *
 * ⚠️ IT NEVER OVERWRITES AN EXISTING ENTRY, and that is the whole contract. A row the reviewer has
 * touched -- including one they deliberately CLEARED, which leaves an entry with a null link -- is
 * theirs. Re-seeding it on the next refetch would silently undo the clear and put the machine's
 * pick back under a person who had just rejected it.
 *
 * ⚠️ IT RETURNS THE SAME MAP WHEN NOTHING WAS ADDED. The page holds this in state and re-runs it on
 * every fetch; handing back a fresh Map each time would change the reference, re-render the table
 * and re-run every memo for no change at all.
 */
export const seedDecisions = (
    rows: OutflowImportRow[],
    existing: ReadonlyMap<string, RowDecision>
): ReadonlyMap<string, RowDecision> => {
    const additions: [string, RowDecision][] = [];
    for (const row of rows) {
        if (existing.has(row.name)) continue;
        const decision = suggestedDecision(row);
        if (decision) additions.push([row.name, decision]);
    }
    if (!additions.length) return existing;
    const next = new Map(existing);
    for (const [name, decision] of additions) next.set(name, decision);
    return next;
};

/**
 * Where a row's current decision came from, so the table can say so.
 *
 * `suggested` means it still matches what the match run proposed -- whether it was seeded or a
 * person happened to pick the same record, which mean the same thing to a reader. `chosen` means a
 * person put something else there. The distinction is DERIVED rather than tracked, so it cannot
 * drift out of step with the decision it describes.
 */
export type DecisionOrigin = "none" | "suggested" | "chosen";

export const decisionOrigin = (
    row: OutflowImportRow,
    decision: RowDecision | undefined
): DecisionOrigin => {
    if (!decision) return "none";
    const suggestion = suggestedDecision(row);
    if (
        suggestion &&
        suggestion.target === decision.target &&
        suggestion.linkTo === decision.linkTo
    ) {
        return "suggested";
    }
    return "chosen";
};

// --- candidate ordering ------------------------------------------------------------------------

export interface CandidateLike {
    name: string;
    amount: number;
    /**
     * Whether the SERVER considers this amount close enough to settle.
     *
     * ⚠️ THE CLIENT MUST NOT HOLD A COPY OF EITHER TOLERANCE. There are now TWO windows and both
     * live in `services/outflow_import/amounts.py`: `AMOUNT_TOLERANCE` is the SETTLE window shared
     * by the pool query and the write guard, and `TIER1_TOLERANCE` is the strict window the
     * matcher's account+IFSC tier uses. This flag reports the first one and nothing else. A number
     * duplicated here would drift the moment the owner changed it -- and it HAS changed, twice --
     * and the symptom would be a screen offering a record the confirm then refuses.
     */
    suggested?: boolean;
}

/**
 * Why confirming this pick would be REFUSED by the server, or `null` if it would not.
 *
 * ⚠️ IT GATES ON THE SERVER'S OWN `suggested` FLAG, NEVER ON A CLIENT COPY OF THE TOLERANCE. See
 * `CandidateLike.suggested` above: both windows live in `services/outflow_import/amounts.py`, they
 * have changed twice, and a number duplicated here would drift into a screen that blocks a record
 * the server would have accepted -- the same class of defect as one that offers a record the server
 * then refuses, in the other direction.
 *
 * ⚠️ IT FAILS OPEN. `suggested` ABSENT (undefined) is "the server did not say", which must NOT
 * block: an older payload or a record shape that never carried the flag would otherwise become
 * unconfirmable, and a screen that silently refuses to settle a valid record is worse than one that
 * lets the server refuse it out loud. Only an explicit `false` blocks.
 *
 * The screen uses this to EXPLAIN rather than to enforce -- the write guard in `settle.py` is the
 * boundary. What it prevents is the shape the owner reported: a Confirm button that is enabled,
 * posts, is refused, and shows nothing, which reads as a broken front end rather than a rule.
 */
export interface SettleBlock {
    kind: "amount_outside_window";
    recordName: string;
    recordAmount: number;
    bankAmount: number;
    /** Signed: record minus bank. Negative means the bank moved MORE than the record is for. */
    difference: number;
}

export const settleBlocker = (
    record: { name: string; amount: number; suggested?: boolean } | null | undefined,
    bankAmount: number
): SettleBlock | null => {
    if (!record) return null;
    if (record.suggested !== false) return null;
    return {
        kind: "amount_outside_window",
        recordName: record.name,
        recordAmount: Number(record.amount),
        bankAmount: Number(bankAmount),
        difference: Number(record.amount) - Number(bankAmount),
    };
};

/**
 * Suggested records first, then closest by amount.
 *
 * ⚠️ NO PRODUCTION CALLER SINCE SLICE N1 -- ONLY THESE TESTS. It was the Link-payment table's
 * ordering, and the server now sends that table already ranked by
 * `services/outflow_import/similarity.py` (project > vendor > nickname/contact > amount, inside a
 * hard settleable/unsettleable split). `RecordPicker` calling this AFTERWARDS would silently
 * re-sort the ranking back into amount order, which is the one thing that would make the
 * similarity_reasons printed on each row disagree with the order they are printed in.
 *
 * ⚠️ SO DO NOT REACH FOR IT AS "the record ordering helper" -- that is exactly the mistake it is
 * now positioned to invite. Kept rather than deleted because it is exported and covered, and
 * because the settleable-first HALF of it is still the rule the server applies; if a future surface
 * needs an amount ordering, this is a correct implementation of one. Deleting it is a reasonable
 * call for whoever confirms nothing else wants it.
 */
export const orderBySuggestion = <T extends CandidateLike>(
    candidates: T[],
    bankAmount: number
): T[] =>
    [...candidates].sort((a, b) => {
        if (Boolean(a.suggested) !== Boolean(b.suggested)) return a.suggested ? -1 : 1;
        return (
            Math.abs(Number(a.amount) - Number(bankAmount)) -
            Math.abs(Number(b.amount) - Number(bankAmount))
        );
    });

// --- the settleable-record table ------------------------------------------------------------------

/**
 * One approved record a reviewer may link a transfer to.
 *
 * Mirrors what `review.search_settleable_records` returns, field for field. Declared here rather
 * than in the dialog so the column model below and the component render from ONE shape.
 */
export interface SettleableRecord {
    /** Which ledger this record lives in. It arrives WITH the record; the reviewer never picks it. */
    target_doctype: DecisionTarget;
    name: string;
    amount: number;
    detail: string;
    suggested: boolean;
    /** The facts a reviewer picks a record BY (owner ruling 2026-08-06). */
    vendor_name: string;
    project_name: string;
    document_name: string;
    /**
     * The vendor's other two names (slice N1). Tier 3 of the similarity ranking, and searchable.
     *
     * ⚠️ BOTH ARE STRUCTURALLY EMPTY ON `Non Project Expenses`, which has no vendor link at all --
     * no column, no join to make. That is a fact about the ledger, not a missing value, and the
     * ranking scores it as no signal rather than as a penalty.
     */
    vendor_nickname: string;
    contact_person: string;
    /**
     * The project's LINK ID, beside `project_name` rather than instead of it (slice N1).
     *
     * ⚠️ `project_name` FALLS BACK TO THE ID when the join finds nothing, so it cannot be compared
     * against what the server's `ProjectIndex` reports -- that speaks in ids. The filter matches on
     * this; the column displays the name. One key cannot carry both jobs.
     */
    project: string;
    /**
     * How much this record looks like the transfer, and why (slice N1).
     *
     * ⚠️ THE SERVER RANKS; THE CLIENT DOES NOT RE-SCORE. The token rules live in
     * `services/outflow_import/similarity.py` beside the tokeniser the matcher uses, and a second
     * implementation here would be free to drift from it. The payload arrives already ordered --
     * `similarity` is carried so the screen can EXPLAIN the order, not reproduce it.
     */
    similarity: number;
    similarity_reasons: string[];
    /**
     * ⚠️ TWO DATE KEYS, NEVER ONE. Only `Project Payments` records an approval date -- neither
     * expense doctype has the field at all. The expense's last-changed timestamp is real and useful
     * for judging how stale a record is, but it is NOT an approval date, so it travels under its own
     * name and is labelled differently on screen (owner ruling 2026-08-06). Merging them into one
     * key would present a modification as an approval on two thirds of the list.
     */
    approved_on: string;
    updated_on: string;
}

/** How each ledger is named ON A RECORD LINE (owner wording, slice R2). Singular -- it labels one
 *  record rather than a table. */
export const LEDGER_LABEL: Record<string, string> = {
    "Project Payments": "Project Payment",
    "Project Expenses": "Project Expense",
    "Non Project Expenses": "Non Project Expense",
};

export const ledgerLabel = (doctype: string): string => LEDGER_LABEL[doctype] ?? doctype;

/**
 * `<doctype>|<name>` -- unique across ledgers, which a bare record name is not guaranteed to be.
 *
 * It is the radio group's value as well as the React key, so the two can never disagree about which
 * row is selected.
 */
export const recordKey = (record: { target_doctype: string; name: string }): string =>
    `${record.target_doctype}|${record.name}`;

/** Split a `recordKey` back into its halves. The doctype half can contain no `|`; the name half may. */
export const parseRecordKey = (
    value: string
): { target: DecisionTarget; name: string } | null => {
    const [target, ...rest] = value.split("|");
    const name = rest.join("|");
    if (!target || !name) return null;
    return { target: target as DecisionTarget, name };
};

/**
 * The record's date, SAYING WHICH DATE IT IS.
 *
 * ⚠️ A PURE FUNCTION RATHER THAN A TERNARY IN JSX, because the distinction is an owner ruling and
 * not a formatting detail. Neither expense doctype carries an approval date -- only
 * `Project Payments` records one -- so a payment reads "approved 12-Jul-2026" and an expense reads
 * "updated 12-Jul-2026". Presenting a modification timestamp under the word "approved" would be a
 * confident lie on two thirds of the list, and a reviewer settling by approval date would have no
 * way to see it. `format` is injected so this stays testable without importing the date utility.
 */
export const recordDateLabel = (
    record: Pick<SettleableRecord, "approved_on" | "updated_on">,
    format: (value: string) => string
): string => {
    if (record.approved_on) return `approved ${format(record.approved_on)}`;
    if (record.updated_on) return `updated ${format(record.updated_on)}`;
    return "";
};

export interface RecordColumn {
    id: string;
    title: string;
    /** Column width. Fixed so the header and the scrolling body stay in step. */
    width: string;
    align?: "right";
    mono?: boolean;
}

/**
 * The columns of the Link payment table, in order.
 *
 * ⚠️ ONE MODEL DRIVES THE HEADER AND THE BODY, exactly as `OUTFLOW_COLUMNS` does for the rows
 * table -- a header list beside a hand-written row of cells is how the two drift apart.
 *
 * The set is the owner's "facts a reviewer picks a record by" (2026-08-06), which used to be
 * crammed onto two wrapped lines of a dropdown option. As columns they can be COMPARED down the
 * page, which is the entire reason this became a table.
 */
/**
 * ⚠️ TYPE AND RECORD ARE ONE COLUMN (owner ruling 2026-08-10). They were two, and the six columns
 * pushed AMOUNT off the right edge -- so the reviewer had to scroll horizontally to see the single
 * fact that decides whether a record can be settled at all. The ledger is a one-word label that
 * belongs with the id it qualifies, not in a column of its own competing for width.
 *
 * The facts did not change; five columns fit where six did not.
 */
export const RECORD_COLUMNS: RecordColumn[] = [
    { id: "record", title: "Record", width: "210px" },
    { id: "vendor", title: "Vendor", width: "180px" },
    { id: "project", title: "Project", width: "160px" },
    { id: "date", title: "Approved", width: "120px" },
    { id: "amount", title: "Amount", width: "150px", align: "right" },
];

/** `same amount ✓` / `differs by ₹X ⚠`, as data. */
export const amountVerdict = (
    candidateAmount: number,
    bankAmount: number
): { same: boolean; difference: number } => {
    const difference = Number(candidateAmount) - Number(bankAmount);
    return { same: difference === 0, difference };
};

// --- small helpers -----------------------------------------------------------------------------

/** A date for DISPLAY, in the app's `dd-MMM-yyyy`. Blank in, blank out — never "Invalid Date". */
function formatIfPresent(value: string | null | undefined): string {
    const iso = dateOnly(value);
    return iso ? formatDate(iso) : "";
}

function dateOnly(value: string | null | undefined): string {
    const text = String(value ?? "");
    if (!text) return "";
    // Frappe hands back "YYYY-MM-DD HH:MM:SS"; the T form appears in parsed payloads.
    return text.split(/[ T]/)[0] || "";
}

function timeOnly(value: string | null | undefined): string {
    const text = String(value ?? "");
    if (!text) return "";
    const part = text.split(/[ T]/)[1] || "";
    return part.slice(0, 5);
}
