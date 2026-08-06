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

import {
    OPEN_ROW_STATUSES,
    ROW_SETTLED,
    ROW_SKIPPED,
} from "./outflowImportStatus";
import type { OutflowImportRow } from "@/types/NirmaanStack/OutflowImportBatch";

/** Which ledger a row is being settled against, or a brand-new expense. */
export type DecisionTarget =
    | "Project Payments"
    | "Project Expenses"
    | "Non Project Expenses"
    | "new";

/** The reviewer's in-progress decision for one row. Client state until they confirm. */
export interface RowDecision {
    target: DecisionTarget;
    /** The record to settle. Required for every target except `new`. */
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

export type ColumnFilterKind = "facet" | "text" | "range" | "none";

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
    { id: "added_on", title: "Payment Date", get: (r) => dateOnly(r.added_on), filter: "facet", mono: true, width: "126px" },
    { id: "beneficiary_name", title: "Beneficiary", get: (r) => r.beneficiary_name ?? "", filter: "facet", width: "230px" },
    { id: "amount", title: "Amount Paid", get: (r) => r.amount ?? 0, filter: "range", align: "right", width: "140px" },
    { id: "remarks", title: "Remarks", get: (r) => r.remarks ?? "", filter: "text", width: "230px" },
    { id: "bank_reference_no", title: "Reference (UTR)", get: (r) => r.bank_reference_no ?? "", filter: "text", mono: true, width: "170px" },
    { id: "row_status", title: "Status", get: (r) => r.row_status ?? "", filter: "facet", width: "130px" },
    // The Outcome cell is a BUTTON, not text, so it neither sorts nor filters -- there is nothing
    // meaningful to order "open this dialog" by.
    { id: "outcome", title: "Outcome", get: (r) => r.outcome_note ?? r.skip_reason ?? "", filter: "none", width: "320px" },
    { id: "bank_account", title: "Bank a/c", get: (r) => r.bank_account ?? "", filter: "facet", mono: true, hiddenByDefault: true, width: "120px" },
    { id: "ifsc", title: "IFSC", get: (r) => r.ifsc ?? "", filter: "facet", mono: true, hiddenByDefault: true, width: "120px" },
    { id: "time", title: "Time", get: (r) => timeOnly(r.added_on), filter: "facet", mono: true, hiddenByDefault: true, width: "84px" },
];

export const DEFAULT_HIDDEN_COLUMNS: string[] = OUTFLOW_COLUMNS.filter(
    (c) => c.hiddenByDefault
).map((c) => c.id);

export type OutflowTab = "pending" | "settled" | "skipped";

export const OUTFLOW_TABS: { id: OutflowTab; label: string }[] = [
    { id: "pending", label: "Pending" },
    { id: "settled", label: "Settled" },
    { id: "skipped", label: "Skipped" },
];

/**
 * Which tab a row belongs in.
 *
 * ⚠️ DERIVED FROM THE STATUS DERIVER, never from a second list of status strings. `Pending` holds
 * everything still OPEN -- which is exactly `OPEN_ROW_STATUSES` -- so adding a status to the
 * vocabulary can never leave it homeless and invisible.
 */
export const tabForStatus = (status: string): OutflowTab => {
    if (status === ROW_SETTLED) return "settled";
    if (status === ROW_SKIPPED) return "skipped";
    return "pending";
};

export const rowsForTab = (rows: OutflowImportRow[], tab: OutflowTab): OutflowImportRow[] =>
    rows.filter((r) => tabForStatus(r.row_status) === tab);

export const tabCounts = (rows: OutflowImportRow[]): Record<OutflowTab, number> => {
    const counts: Record<OutflowTab, number> = { pending: 0, settled: 0, skipped: 0 };
    for (const row of rows) counts[tabForStatus(row.row_status)] += 1;
    return counts;
};

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

export const matchesQuery = (row: OutflowImportRow, query: string): boolean => {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return SEARCHABLE_FIELDS.some((field) =>
        String(row[field] ?? "").toLowerCase().includes(needle)
    );
};

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

/** Facet -> the chosen values; text -> a substring; range -> min/max. */
export type ColumnFilters = Record<string, string[] | string | RangeFilter | undefined>;

/**
 * AND across columns, OR within a column (owner ruling; same semantics as the Rate Master viewer).
 *
 * An EMPTY facet selection means "no filter on this column", not "match nothing" -- otherwise
 * unticking the last value would blank the table instead of clearing the filter, which reads as a
 * bug every time.
 */
export const passesFilters = (
    row: OutflowImportRow,
    filters: ColumnFilters,
    columns: OutflowColumn[] = OUTFLOW_COLUMNS
): boolean =>
    columns.every((column) => {
        const filter = filters[column.id];
        if (filter == null) return true;
        const value = column.get(row);

        if (column.filter === "facet") {
            const chosen = filter as string[];
            return !chosen.length || chosen.includes(String(value ?? ""));
        }
        if (column.filter === "text") {
            const needle = String(filter).trim().toLowerCase();
            return !needle || String(value ?? "").toLowerCase().includes(needle);
        }
        if (column.filter === "range") {
            const { min, max } = (filter as RangeFilter) || {};
            const numeric = Number(value ?? 0);
            if (min != null && numeric < min) return false;
            if (max != null && numeric > max) return false;
            return true;
        }
        return true;
    });

export const activeFilterCount = (filters: ColumnFilters): number =>
    Object.values(filters).filter((filter) => {
        if (filter == null) return false;
        if (Array.isArray(filter)) return filter.length > 0;
        if (typeof filter === "string") return filter.trim().length > 0;
        const range = filter as RangeFilter;
        return range.min != null || range.max != null;
    }).length;

/** The distinct values a facet column offers, in display order. */
export const facetValues = (
    rows: OutflowImportRow[],
    column: OutflowColumn
): string[] => {
    const seen = new Set<string>();
    for (const row of rows) {
        const value = String(column.get(row) ?? "");
        if (value) seen.add(value);
    }
    return [...seen].sort((a, b) => a.localeCompare(b));
};

// --- sorting -----------------------------------------------------------------------------------

export interface SortState {
    columnId: string | null;
    direction: "asc" | "desc";
}

export const visibleRows = (
    rows: OutflowImportRow[],
    options: { query?: string; filters?: ColumnFilters; sort?: SortState } = {}
): OutflowImportRow[] => {
    const { query = "", filters = {}, sort } = options;
    const out = rows.filter(
        (row) => matchesQuery(row, query) && passesFilters(row, filters)
    );

    const column = sort?.columnId
        ? OUTFLOW_COLUMNS.find((c) => c.id === sort.columnId)
        : undefined;
    if (!column) return out;

    // Copied before sorting: `rows` belongs to the caller, and sorting it in place would mutate
    // state React is holding.
    return [...out].sort((a, b) => {
        const left = column.get(a);
        const right = column.get(b);
        let delta: number;
        if (column.id === "added_on" || column.id === "time") {
            // Dates compare as their raw ISO-ish strings, which sort correctly and avoid
            // constructing a Date per comparison.
            delta = String(a.added_on ?? "").localeCompare(String(b.added_on ?? ""));
        } else if (typeof left === "number" || typeof right === "number") {
            delta = Number(left ?? 0) - Number(right ?? 0);
        } else {
            delta = String(left ?? "").localeCompare(String(right ?? ""));
        }
        return sort!.direction === "asc" ? delta : -delta;
    });
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
    return Boolean(decision.linkTo);
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

// --- candidate ordering ------------------------------------------------------------------------

export interface CandidateLike {
    name: string;
    amount: number;
}

/**
 * Exact-amount records first, and a pre-selection ONLY when exactly one is exact.
 *
 * ⚠️ TWO EXACT MATCHES IS AMBIGUITY, AND THE SCREEN NEVER GUESSES BETWEEN TWO REAL RECORDS (owner
 * ruling). Pre-selecting either would turn a suggestion the reviewer is supposed to make into a
 * decision the software made and they rubber-stamped.
 */
export const orderCandidates = <T extends CandidateLike>(
    candidates: T[],
    bankAmount: number
): T[] =>
    [...candidates].sort((a, b) => {
        const aExact = Number(a.amount) === Number(bankAmount) ? 0 : 1;
        const bExact = Number(b.amount) === Number(bankAmount) ? 0 : 1;
        if (aExact !== bExact) return aExact - bExact;
        return String(a.name).localeCompare(String(b.name));
    });

export const soleExactMatch = <T extends CandidateLike>(
    candidates: T[],
    bankAmount: number
): T | null => {
    const exact = candidates.filter((c) => Number(c.amount) === Number(bankAmount));
    return exact.length === 1 ? exact[0] : null;
};

/** `same amount ✓` / `differs by ₹X ⚠`, as data. */
export const amountVerdict = (
    candidateAmount: number,
    bankAmount: number
): { same: boolean; difference: number } => {
    const difference = Number(candidateAmount) - Number(bankAmount);
    return { same: difference === 0, difference };
};

// --- small helpers -----------------------------------------------------------------------------

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
