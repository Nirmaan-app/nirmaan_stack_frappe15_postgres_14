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
    ROW_PENDING_MATCH,
    ROW_SETTLED,
    ROW_SKIPPED,
} from "./outflowImportStatus";
import { paymentHref } from "@/pages/ProjectPayments/config/projectPaymentsTable.config";
import type { OutflowImportRow } from "@/types/NirmaanStack/OutflowImportBatch";

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

/** Suggested records first, then closest by amount. */
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
export const RECORD_COLUMNS: RecordColumn[] = [
    { id: "type", title: "Type", width: "140px" },
    { id: "record", title: "Record", width: "150px", mono: true },
    { id: "vendor", title: "Vendor", width: "180px" },
    { id: "project", title: "Project", width: "160px" },
    { id: "date", title: "Approved", width: "130px" },
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
