// src/pages/outflow-import/components/SettleableRecordTable.tsx

import { AlertTriangle, Check } from "lucide-react";

import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee, { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import {
    RECORD_COLUMNS,
    amountVerdict,
    ledgerLabel,
    recordDateLabel,
    recordKey,
    type SettleableRecord,
} from "../outflowTableModel";
import {
    reasonCaption,
    type FacetOption,
    type RecordFilters,
    type RecordSort,
    type RecordSortColumn,
} from "../recordPickerView";
import { RecordColumnHeader } from "./RecordColumnHeader";

interface Props {
    records: SettleableRecord[];
    /** The chosen record's `recordKey`, or `""` for none chosen. */
    selected: string;
    onSelect: (key: string) => void;
    /** The bank row's amount, for the per-row amount verdict. */
    bankAmount: number;
    /**
     * `recordKey`s the match run found for this transfer (slice N3).
     *
     * ⚠️ A GRID-LEVEL SET, and each row gets only its own BOOLEAN. Same discipline as everything
     * else in this repo that renders a collection: handing the whole set to a row makes the row's
     * props change identity whenever any part of it does.
     */
    matcherCandidates: ReadonlySet<string>;
    /**
     * The view state (slice N1). It lives in the PICKER, not in here: the count line, the Clear
     * control and this table must agree about what is filtered, and two copies of that state is
     * how they come to disagree.
     */
    sort: RecordSort | null;
    onSort: (column: RecordSortColumn) => void;
    filters: RecordFilters;
    /** Distinct values across the WHOLE pool, not the filtered view -- see the note in the body. */
    facets: { vendors: FacetOption[]; projects: FacetOption[] };
    onFiltersChange: (next: RecordFilters) => void;
}

/**
 * The approved records this transfer could have paid, as a table with a radio per row.
 *
 * ⚠️ IT REPLACED A DROPDOWN, AND THE SHAPE IS THE POINT (owner, 2026-08-07). Each option used to
 * carry type, id, vendor, project, document, date, amount and a tolerance mark on two wrapped
 * lines, which meant a reviewer choosing between three approved records had to open the list, read
 * eight stacked facts three times over, and hold the comparison in their head. Comparison down a
 * column is what a table is for. The facts did not change -- their arrangement did.
 *
 * ⚠️ THE HEIGHT IS FIXED AND THE BODY SCROLLS INSIDE IT. The dialog already owns its own scrollbar
 * with a pinned header and footer; a list that grows with the result count pushes Confirm -- the one
 * control the dialog exists for -- down the body and out of reach. Bounding the table here is what
 * keeps the dialog's own height constant however many records come back.
 *
 * ⚠️ RECORDS OUTSIDE THE TOLERANCE ARE SHOWN AND MARKED, NEVER HIDDEN. Someone hunting a TDS
 * payment needs to SEE the one that differs by 2,000 in order to learn that it cannot be settled
 * here; filtering it out looks like the record does not exist.
 *
 * ⚠️ IT IS A REAL `<input type="radio">` IN A REAL RADIOGROUP. Arrow-key navigation between options,
 * the roving tab stop and the announced group name all come free from the platform and are
 * fiddly to rebuild on divs -- and this is the control that decides where money is written.
 */
export const SettleableRecordTable = ({
    records,
    selected,
    onSelect,
    bankAmount,
    matcherCandidates,
    sort,
    onSort,
    filters,
    facets,
    onFiltersChange,
}: Props) => (
    // The bound is on the SCROLL CONTAINER, not on the table, so the header can be sticky INSIDE it:
    // a max-height on the table itself would scroll the header away with the rows.
    //
    // ⚠️ 260px -> 420px AT SLICE N1. 260 was sized for a list of at most 50 records that the server
    // had already narrowed by amount; this table now holds the WHOLE approved pool and is meant to
    // be browsed, filtered and sorted.
    //
    // ⚠️ 420px -> `min(420px, 38vh)` AT SLICE D2, AND THE `vh` HALF IS THE FIX. A FIXED bound is
    // right about the table and wrong about the SCREEN: the dialog body is capped at 85vh, and on a
    // short viewport a fixed 420px table plus the header, the filters, the verdict line and the
    // footer exceeds that -- so the BODY scrolls, and "Clear selection", which sits below the
    // table, goes under the fold. The owner reported exactly that. It is not reachable by any
    // control on screen, because the thing that scrolled it out of view is the thing you would
    // scroll to reach it.
    //
    // `min()` keeps today's 420px on a tall screen (nothing changes at 1080p and above) and lets
    // the table give way first on a short one, so the DIALOG BODY never overflows and the controls
    // beneath the table are always visible. There are two nested scrollers here by design -- this
    // one and the body's -- and the point of the bound is that only the inner one is ever used.
    //
    // ⚠️ DO NOT "SIMPLIFY" THIS BACK TO A BARE `vh`. The 420px ceiling is what stops the table
    // growing to fill a very tall monitor, which would push the same controls down again.
    <div className="max-h-[min(420px,38vh)] overflow-y-auto rounded-md border">
        <table className="w-full table-fixed border-collapse text-sm">
            <colgroup>
                {/* The radio column, then one per model column -- so the header cells and the body
                    cells cannot drift apart. */}
                <col style={{ width: "40px" }} />
                {RECORD_COLUMNS.map((column) => (
                    <col key={column.id} style={{ width: column.width }} />
                ))}
            </colgroup>
            <thead className="sticky top-0 z-10 bg-muted/60 backdrop-blur">
                <tr>
                    <th className="w-10 border-b px-2 py-2">
                        <span className="sr-only">Choose</span>
                    </th>
                    {RECORD_COLUMNS.map((column) => (
                        <th
                            key={column.id}
                            className={`border-b px-2 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground ${
                                column.align === "right" ? "text-right" : ""
                            }`}
                        >
                            {/* ⚠️ THE RECORD COLUMN IS NOT SORTABLE OR FILTERABLE, and that is the
                                owner's list rather than an omission: Vendor, Project, Approved and
                                Amount are the four facts a reviewer narrows by. The id column
                                carries the ledger label and the record name, neither of which is
                                something anyone filters a list of approved records down to. */}
                            {column.id === "record" ? (
                                column.title
                            ) : (
                                <RecordColumnHeader
                                    title={column.title}
                                    column={column.id as RecordSortColumn}
                                    sort={sort}
                                    onSort={onSort}
                                    align={column.align}
                                    filter={filterSpecFor(
                                        column.id as RecordSortColumn,
                                        filters,
                                        facets,
                                        onFiltersChange
                                    )}
                                />
                            )}
                        </th>
                    ))}
                </tr>
            </thead>
            <tbody role="radiogroup" aria-label="Approved records this transfer could have paid">
                {records.map((record) => (
                    <RecordRow
                        key={recordKey(record)}
                        record={record}
                        chosen={recordKey(record) === selected}
                        onSelect={onSelect}
                        bankAmount={bankAmount}
                        // Computed here rather than in the row so the rule lives in ONE pure,
                        // unit-tested place — see `reasonCaption` on why it goes silent under a sort.
                        reason={reasonCaption(record, sort)}
                        matched={matcherCandidates.has(recordKey(record))}
                    />
                ))}
            </tbody>
        </table>
    </div>
);

/**
 * Which filter each column carries.
 *
 * ⚠️ THE FACET LISTS ARE BUILT FROM THE WHOLE POOL, NEVER FROM THE FILTERED VIEW. Deriving them
 * from what is currently visible makes a filter one-way: pick a vendor, and every other vendor
 * disappears from the list you would need in order to change your mind.
 */
const filterSpecFor = (
    column: RecordSortColumn,
    filters: RecordFilters,
    facets: { vendors: FacetOption[]; projects: FacetOption[] },
    onChange: (next: RecordFilters) => void
) => {
    switch (column) {
        case "vendor":
            return {
                kind: "facet" as const,
                options: facets.vendors,
                selected: filters.vendors,
                onChange: (vendors: ReadonlySet<string>) => onChange({ ...filters, vendors }),
            };
        case "project":
            return {
                kind: "facet" as const,
                options: facets.projects,
                selected: filters.projects,
                onChange: (projects: ReadonlySet<string>) => onChange({ ...filters, projects }),
            };
        case "amount":
            return {
                kind: "amount" as const,
                min: filters.amountMin,
                max: filters.amountMax,
                onChange: (amountMin: number | null, amountMax: number | null) =>
                    onChange({ ...filters, amountMin, amountMax }),
            };
        default:
            return {
                kind: "date" as const,
                from: filters.dateFrom,
                to: filters.dateTo,
                onChange: (dateFrom: string | null, dateTo: string | null) =>
                    onChange({ ...filters, dateFrom, dateTo }),
            };
    }
};

const RecordRow = ({
    record,
    chosen,
    onSelect,
    bankAmount,
    reason,
    matched,
}: {
    record: SettleableRecord;
    chosen: boolean;
    onSelect: (key: string) => void;
    bankAmount: number;
    /** Why this record ranks here, or `""` for nothing to say. See `reasonCaption`. */
    reason: string;
    /** The match run found this record for this transfer (slice N3). */
    matched: boolean;
}) => {
    const key = recordKey(record);
    const verdict = amountVerdict(record.amount, bankAmount);
    const date = recordDateLabel(record, formatDate);

    return (
        <tr
            // The whole row is the hit target -- a 14px radio is not. `cursor-pointer` and the hover
            // tint say so; the radio stays as the thing that LOOKS chosen.
            className={`cursor-pointer border-b last:border-b-0 transition-colors focus-within:bg-primary/10 ${
                chosen ? "bg-primary/5" : "hover:bg-muted/50"
            }`}
            onClick={() => onSelect(key)}
        >
            <td className="px-2 py-2 align-top">
                <input
                    type="radio"
                    // One group per dialog. Without a shared name the browser treats each input as
                    // its own group and arrow keys stop moving between them.
                    name="settleable-record"
                    className="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-primary"
                    value={key}
                    checked={chosen}
                    onChange={() => onSelect(key)}
                    aria-label={`${ledgerLabel(record.target_doctype)} ${record.name}${
                        record.vendor_name ? `, ${record.vendor_name}` : ""
                    }, ${formatToRoundedIndianRupee(record.amount)}`}
                />
            </td>

            {/* ⚠️ THE TYPE IS NOT DECORATION, AND IT IS NOT ITS OWN COLUMN EITHER (owner ruling
                2026-08-10). One list holds all three ledgers, so the label is the only thing on the
                row saying whether this is a payment against a PO or an expense somebody booked --
                which is what three separate cards used to say by existing. But as a sixth column it
                pushed AMOUNT past the right edge, and the amount is the fact that decides whether a
                record can be settled at all. It stacks above the id it qualifies instead. */}
            <td className="px-2 py-2 align-top">
                <span className="inline-block rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground/70">
                    {ledgerLabel(record.target_doctype)}
                </span>
                {/* ⚠️ NEUTRAL, NOT EMERALD (slice N3). Emerald on this screen means settleable --
                    the amount mark below uses it -- and being a candidate is neither a verdict nor
                    a permission. The title says FOUND, never "available": these come from a live
                    re-run that skips the claim pass, so one may already be held by another row. */}
                {matched && (
                    <span
                        className="ml-1 inline-block rounded border border-sky-600/40 px-1.5 py-0.5 text-[11px] font-medium text-sky-700"
                        title="The match run found this record for this transfer, but could not choose between several. Another transfer may already have claimed it."
                    >
                        candidate
                    </span>
                )}
                <div className="mt-0.5 truncate font-mono text-xs" title={record.name}>
                    {record.name}
                </div>
                {/* ⚠️ WHY THIS RECORD IS WHERE IT IS (slice N2). The whole list is ordered by
                    `similarity.py` and, until N2, nothing on screen said so — a record could sit
                    first on an exact vendor match plus a named project and read as though the order
                    were arbitrary. The full text is in the `title` because 210px truncates the
                    common two-reason case; the caption is the invitation to hover, not the whole
                    answer. It is BLANK under an explicit sort by construction — see `reasonCaption`. */}
                {reason && (
                    <div
                        className="mt-0.5 truncate text-[11px] leading-tight text-muted-foreground"
                        title={reason}
                    >
                        {reason}
                    </div>
                )}
            </td>

            {/* ⚠️ `PAY-00105-034` SAYS NOTHING ABOUT WHOSE MONEY IT IS. A reviewer with three
                approved records in front of them picks by vendor and project. An em dash rather
                than a blank, so an absent vendor reads as absent rather than as a rendering gap. */}
            {/* ⚠️ THE NICKNAME IS SHOWN ONLY WHEN IT ADDS SOMETHING. It is tier 3 of the ranking,
                so a record can be near the top BECAUSE of it -- and a reviewer who cannot see the
                name that put it there has been given an order they cannot check. Suppressed when it
                merely repeats the vendor name, which would be noise on every row that has one. */}
            <td className="px-2 py-2 align-top" title={record.vendor_name || undefined}>
                <div className="truncate">
                    {record.vendor_name || <span className="text-muted-foreground">—</span>}
                </div>
                {record.vendor_nickname && record.vendor_nickname !== record.vendor_name && (
                    <div className="truncate text-[11px] text-muted-foreground">
                        {record.vendor_nickname}
                    </div>
                )}
            </td>

            <td
                className="truncate px-2 py-2 align-top text-muted-foreground"
                title={record.project_name || undefined}
            >
                {record.project_name || "—"}
            </td>

            {/* "approved" vs "updated" -- see `recordDateLabel`; the word is the guard. */}
            <td className="truncate px-2 py-2 align-top text-xs text-muted-foreground" title={date}>
                {date || "—"}
            </td>

            <td className="px-2 py-2 align-top text-right">
                <span className="block tabular-nums">
                    {formatToRoundedIndianRupee(record.amount)}
                </span>
                <AmountMark suggested={record.suggested} difference={verdict.difference} />
            </td>
        </tr>
    );
};

/**
 * Whether this record's amount can be settled, in the cell where the amount already is.
 *
 * ⚠️ THREE STATES, NOT TWO. Exact / within the tolerance / outside it. Two states would have to
 * call a 31-paise difference either "same" (untrue) or a warning (misleading, since the system
 * settles it happily) -- and the bank rounds to the rupee on about a third of all payments, so the
 * middle case is the common one, not the rare one.
 *
 * The tolerance's VALUE is deliberately not named: it lives on the server, and a number repeated in
 * the client would drift the moment the owner changed it -- which has now happened twice.
 */
const AmountMark = ({
    suggested,
    difference,
}: {
    suggested: boolean;
    difference: number;
}) => {
    if (difference === 0) {
        return (
            <span className="flex items-center justify-end gap-1 text-[11px] text-emerald-700">
                <Check className="h-3 w-3" /> same
            </span>
        );
    }
    // ⚠️ TO THE PAISE. The rounded formatter ceils, so the COMMON gap here -- the bank rounding a
    // paise amount -- rendered as "off by ₹1" for 31 paise: a wrong number, in the cell whose whole
    // job is to say how far apart the two amounts are.
    const gap = formatToIndianRupee(Math.abs(difference));
    if (suggested) {
        return (
            <span
                className="flex items-center justify-end gap-1 text-[11px] text-emerald-700"
                title={`Differs by ${gap} — within the accepted rounding tolerance, so this can be settled`}
            >
                <Check className="h-3 w-3" /> off by {gap}
            </span>
        );
    }
    return (
        <span
            className="flex items-center justify-end gap-1 text-[11px] text-amber-700"
            title={`Differs by ${gap} — too far apart to settle here. A deduction such as TDS looks like this; settle it in the payments screen`}
        >
            <AlertTriangle className="h-3 w-3" /> off by {gap}
        </span>
    );
};
