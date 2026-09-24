// src/pages/outflow-import/components/OutflowRowsTable.tsx

import { memo, useEffect, useMemo, useState, type ReactNode } from "react";
import * as HoverCardPrimitive from "@radix-ui/react-hover-card";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, ChevronRight, CornerUpLeft, ExternalLink, Filter, Landmark, List, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { OutflowImportRow } from "@/types/NirmaanStack/OutflowImportBatch";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import { DateFilterPopover } from "@/components/data-table/date-filter-popover";

import { TERMINAL_ROW_STATUSES, rowStatusLabel, rowStatusTone } from "../outflowImportStatus";
import {
    OUTFLOW_COLUMNS,
    SERVER_SORT_COLUMNS,
    highlightSegments,
    amountToneClass,
    isDateFilterValue,
    outcomeNoteOf,
    referenceValue,
    rowSettlementLinks,
    settledBankLineTargets,
    shortReference,
    skippedByHandLine,
    wrapRemarks,
    type ColumnFilters,
    type DecisionOrigin,
    type OutflowColumn,
    type RangeFilter,
    type SettledBankLineTarget,
    type SettlementLink,
    type SortState,
} from "../outflowTableModel";
import { ExpenseBankLinesDialog } from "@/pages/ProjectPayments/components/ExpenseBankLinesPopover";
import { skipSourceSummary } from "../skipSourceView";
import { partlyAllocatedFigures } from "../allocationView";
import {
    CONFIRM_BY_HAND_CHIP,
    confirmByHandNote,
    unreconcileAffordance,
} from "../unreconcileView";

interface Props {
    rows: OutflowImportRow[];
    /**
     * The distinct values one funnel offers, fetched when it is OPENED (slice X3).
     *
     * ⚠️ IT REPLACED A `facetSource` ARRAY OF ROWS, and the replacement was forced by paging. The
     * funnels used to be built from the rows the client held; a page of fifty rows knows fifty
     * beneficiaries, so the same code against a paged table would offer a funnel that silently
     * hides most of its own options. The values now come from the server, over the whole filtered
     * table, and are fetched LAZILY -- on first open, not on mount -- so a table with six funnels
     * does not fire six queries nobody asked for.
     */
    loadFacetValues: (columnId: string) => Promise<string[]>;
    query: string;
    filters: ColumnFilters;
    sort: SortState;
    hiddenColumns: ReadonlySet<string>;
    selected: ReadonlySet<string>;
    decidedRowNames: ReadonlySet<string>;
    /** Whether each row's decision came from the match run or from a person. */
    originByRow: ReadonlyMap<string, DecisionOrigin>;
    /**
     * Which rows on this page may be ticked.
     *
     * ⚠️ PER ROW SINCE THE 2026-08-10 RETAB, AND IT HAD TO BECOME PER ROW. It used to be one
     * boolean for the whole table, which worked while the tabs partitioned open from terminal:
     * Pending was entirely selectable, Settled and Skipped entirely not. The new tabs do not
     * partition that way -- "Matched / Settled" deliberately pairs an OPEN status with a TERMINAL
     * one, and "All" mixes everything -- so a table-level flag would either offer a checkbox on a
     * settled row (which the confirm would then refuse) or withhold it from the matched rows that
     * are the entire point of that tab.
     */
    selectableRowNames: ReadonlySet<string>;
    onSort: (columnId: string) => void;
    onFilter: (columnId: string, value: ColumnFilters[string]) => void;
    onToggleRow: (name: string) => void;
    onToggleAll: (names: string[]) => void;
    onOpenDecision: (row: OutflowImportRow) => void;
    /**
     * One extra column after the others, for a surface with its own per-row action -- the Skipped
     * popup's Unskip (#1274). Absent everywhere else, so the page's table is unchanged.
     *
     * ⚠️ PASS A STABLE OBJECT (`useMemo`). Every memoized row receives it, so a new object per render
     * re-renders every row.
     */
    actionColumn?: TableActionColumn;
    /**
     * The column set, when a surface needs a different one -- the Skipped popup swaps Outcome for Skip
     * Type (`SKIPPED_COLUMNS`). Absent = the page's `OUTFLOW_COLUMNS`, so the page is unchanged.
     *
     * ⚠️ PASS A MODULE CONSTANT, never a list built per render: it feeds a `useMemo`, and every
     * memoized row receives the filtered result.
     */
    columns?: readonly OutflowColumn[];
    /**
     * Open the Unreconcile dialog for a Settled line (#1275). PRESENCE IS THE GATE: the page passes it
     * only for the undo roles, so a plain Accountant sees no button.
     *
     * ⚠️ PASS A STABLE CALLBACK (`useCallback`). Every memoized row receives it.
     */
    onUnreconcile?: (row: OutflowImportRow) => void;
}

export interface TableActionColumn {
    title: string;
    render: (row: OutflowImportRow) => ReactNode;
}

/**
 * The dense transfers table (slice V4).
 *
 * ⚠️ THE PROTOTYPE'S RULE -- "selection must never re-render the table body" -- TRANSLATES, IT DOES
 * NOT TRANSFER LITERALLY. There it was fatal because ticking a box rebuilt `<tbody>`'s innerHTML,
 * replacing every checkbox element, so a second click landed on a detached node and was lost, and
 * scroll and focus were thrown away each time. React's reconciler does not replace those nodes, so
 * the LOST-CLICK failure cannot occur here. What survives is the performance half, and the way to
 * honour it is the same: a row is `memo`'d and receives its OWN `selected` boolean, never the
 * shared Set. Hand a memoized row the Set and every row re-renders on every tick.
 */
export const OutflowRowsTable = ({
    rows,
    loadFacetValues,
    query,
    filters,
    sort,
    hiddenColumns,
    selected,
    decidedRowNames,
    originByRow,
    selectableRowNames,
    onSort,
    onFilter,
    onToggleRow,
    onToggleAll,
    onOpenDecision,
    actionColumn,
    onUnreconcile,
    columns: columnSet = OUTFLOW_COLUMNS,
}: Props) => {
    const columns = useMemo(
        () => columnSet.filter((c) => !hiddenColumns.has(c.id)),
        [columnSet, hiddenColumns]
    );
    // ⚠️ SELECT-ALL ACTS ON THE SELECTABLE ROWS, NOT EVERY ROW ON THE PAGE. On a mixed tab the two
    // differ, and ticking a settled row would put it in a selection the confirm then silently
    // ignores -- so the bulk bar would say "12 selected · 4 decided" with no way to see why.
    const names = useMemo(
        () => rows.map((r) => r.name).filter((n) => selectableRowNames.has(n)),
        [rows, selectableRowNames]
    );
    // ⚠️ The checkbox COLUMN is present whenever this page holds anything tickable. A tab that
    // happens to load a page of purely terminal rows drops it rather than showing a dead column.
    const selectable = names.length > 0;
    const allSelected = names.length > 0 && names.every((n) => selected.has(n));

    if (!rows.length) {
        return (
            <div className="rounded-md border p-8 text-center text-sm text-muted-foreground">
                Nothing here.
            </div>
        );
    }

    return (
        <div className="overflow-x-auto rounded-md border">
            <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-muted/60 backdrop-blur">
                    <tr>
                        {selectable && (
                            <th className="w-9 px-2 py-2">
                                <Checkbox
                                    checked={allSelected}
                                    onCheckedChange={() => onToggleAll(names)}
                                    aria-label="Select all rows"
                                />
                            </th>
                        )}
                        {columns.map((column) => (
                            <HeaderCell
                                key={column.id}
                                column={column}
                                sort={sort}
                                filters={filters}
                                loadFacetValues={loadFacetValues}
                                onSort={onSort}
                                onFilter={onFilter}
                            />
                        ))}
                        {actionColumn && (
                            <th className="px-2 py-2 text-left text-xs font-medium text-muted-foreground">
                                {actionColumn.title}
                            </th>
                        )}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row) => (
                        <Row
                            key={row.name}
                            row={row}
                            columns={columns}
                            query={query}
                            selectable={selectable}
                            // ⚠️ The row's OWN boolean, like `selected` -- never the Set. Handing a
                            // memoized row the Set re-renders every row on every tick.
                            rowSelectable={selectableRowNames.has(row.name)}
                            selected={selected.has(row.name)}
                            decided={decidedRowNames.has(row.name)}
                            origin={originByRow.get(row.name) ?? "none"}
                            onToggleRow={onToggleRow}
                            onOpenDecision={onOpenDecision}
                            actionColumn={actionColumn}
                            onUnreconcile={onUnreconcile}
                        />
                    ))}
                </tbody>
            </table>
        </div>
    );
};

const HeaderCell = ({
    column,
    sort,
    filters,
    loadFacetValues,
    onSort,
    onFilter,
}: {
    column: OutflowColumn;
    sort: SortState;
    filters: ColumnFilters;
    loadFacetValues: (columnId: string) => Promise<string[]>;
    onSort: (columnId: string) => void;
    onFilter: (columnId: string, value: ColumnFilters[string]) => void;
}) => {
    const sorted = sort.columnId === column.id;
    // ⚠️ SORTING IS THE SERVER'S NOW, so only the columns IT knows are clickable. A header that
    // still looked sortable but silently did nothing would be worse than one that looks inert --
    // and sending an unknown sort key would fail the whole page load over a cosmetic click.
    const sortable = SERVER_SORT_COLUMNS.includes(column.id);
    const filter = filters[column.id];
    const active = Array.isArray(filter)
        ? filter.length > 0
        : typeof filter === "string"
          ? filter.trim().length > 0
          : isDateFilterValue(filter)
            ? Boolean(filter.value)
            : Boolean(
                  filter &&
                      ((filter as RangeFilter).min != null || (filter as RangeFilter).max != null)
              );

    /**
     * The funnel itself. Shared by both branches below so an active date filter and an active facet
     * cannot end up looking different from each other.
     */
    const trigger = (
        <button
            type="button"
            aria-label={`Filter ${column.title}`}
            className={`rounded p-0.5 ${
                active ? "text-primary" : "text-muted-foreground/50 hover:text-muted-foreground"
            }`}
        >
            <Filter className="h-3 w-3" />
        </button>
    );

    return (
        <th
            style={{ width: column.width }}
            className={`px-2 py-2 text-left font-medium ${column.align === "right" ? "text-right" : ""}`}
        >
            <div className="flex items-center gap-1">
                {!sortable ? (
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">
                        {column.title}
                    </span>
                ) : (
                    <button
                        type="button"
                        onClick={() => onSort(column.id)}
                        className={`flex items-center gap-1 text-xs uppercase tracking-wide hover:text-foreground ${
                            sorted ? "text-foreground" : "text-muted-foreground"
                        }`}
                    >
                        {column.title}
                        {sorted &&
                            (sort.direction === "asc" ? (
                                <ArrowUp className="h-3 w-3" />
                            ) : (
                                <ArrowDown className="h-3 w-3" />
                            ))}
                    </button>
                )}

                {/* ⚠️ THE DATE COLUMN BRINGS ITS OWN POPOVER (slice P1), so it branches here rather
                    than becoming another case inside `ColumnFilterBody`. `DateFilterPopover` is the
                    app's standard date filter -- the exact control every DataTable screen uses --
                    and it owns its own open state, its Apply/Clear footer and its trigger. Nesting
                    it inside the generic popover would put a popover in a popover and give it two
                    sets of footer buttons.

                    ⚠️ IT EDITS THE SCREEN'S PERIOD. `onFilter("added_on", ...)` is routed by
                    `useOutflowRows` to the shared store, so changing it here moves the Period
                    control above the summary and the summary figures with it. That is the design:
                    one value, two editors. */}
                {column.filter === "date" ? (
                    <DateFilterPopover
                        id={column.id}
                        value={isDateFilterValue(filter) ? filter : undefined}
                        onChange={(next) => onFilter(column.id, next)}
                    >
                        {trigger}
                    </DateFilterPopover>
                ) : column.filter !== "none" ? (
                    <Popover>
                        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
                        <PopoverContent align="start" className="w-64 p-3">
                            {/* Radix mounts this only when the popover OPENS, which is what makes
                                the facet fetch lazy without any open-state bookkeeping here. */}
                            <ColumnFilterBody
                                column={column}
                                filter={filter}
                                loadFacetValues={loadFacetValues}
                                onFilter={onFilter}
                            />
                        </PopoverContent>
                    </Popover>
                ) : null}
            </div>
        </th>
    );
};

const ColumnFilterBody = ({
    column,
    filter,
    loadFacetValues,
    onFilter,
}: {
    column: OutflowColumn;
    filter: ColumnFilters[string];
    loadFacetValues: (columnId: string) => Promise<string[]>;
    onFilter: (columnId: string, value: ColumnFilters[string]) => void;
}) => {
    if (column.filter === "text") {
        return (
            <Input
                autoFocus
                className="h-8"
                placeholder="Contains…"
                value={(filter as string) ?? ""}
                onChange={(e) => onFilter(column.id, e.target.value)}
            />
        );
    }

    if (column.filter === "range") {
        const range = (filter as RangeFilter) ?? {};
        return (
            <div className="flex items-center gap-2">
                <Input
                    className="h-8"
                    type="number"
                    placeholder="Min"
                    value={range.min ?? ""}
                    onChange={(e) =>
                        onFilter(column.id, {
                            ...range,
                            min: e.target.value === "" ? null : Number(e.target.value),
                        })
                    }
                />
                <span className="text-muted-foreground">–</span>
                <Input
                    className="h-8"
                    type="number"
                    placeholder="Max"
                    value={range.max ?? ""}
                    onChange={(e) =>
                        onFilter(column.id, {
                            ...range,
                            max: e.target.value === "" ? null : Number(e.target.value),
                        })
                    }
                />
            </div>
        );
    }

    // Facet. Values arrive from the server, over the WHOLE filtered table, and deliberately
    // WITHOUT this column's own selection applied -- otherwise the list would collapse to whatever
    // is already ticked the moment you opened it, and there would be no way back to the values you
    // unticked.
    return (
        <FacetFilterBody
            column={column}
            filter={filter}
            loadFacetValues={loadFacetValues}
            onFilter={onFilter}
        />
    );
};

const FacetFilterBody = ({
    column,
    filter,
    loadFacetValues,
    onFilter,
}: {
    column: OutflowColumn;
    filter: ColumnFilters[string];
    loadFacetValues: (columnId: string) => Promise<string[]>;
    onFilter: (columnId: string, value: ColumnFilters[string]) => void;
}) => {
    const chosen = useMemo(() => (filter as string[]) ?? [], [filter]);
    const [values, setValues] = useState<string[] | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let live = true;
        loadFacetValues(column.id)
            .then((next) => live && setValues(next))
            .catch(() => live && setFailed(true));
        return () => {
            // The popover can close before the fetch lands; setting state on the way out is the
            // classic React warning, and here it would also be pointless work.
            live = false;
        };
    }, [column.id, loadFacetValues]);

    if (failed) {
        return <p className="text-xs text-destructive">Could not load the values to filter on.</p>;
    }
    if (values === null) {
        return <p className="text-xs text-muted-foreground">Loading…</p>;
    }

    return (
        <div className="max-h-64 space-y-1 overflow-y-auto">
            {values.length === 0 && (
                <p className="text-xs text-muted-foreground">Nothing to filter on.</p>
            )}
            {values.map((value) => (
                <label
                    key={value}
                    className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted"
                >
                    <Checkbox
                        checked={chosen.includes(value)}
                        onCheckedChange={() =>
                            onFilter(
                                column.id,
                                chosen.includes(value)
                                    ? chosen.filter((v) => v !== value)
                                    : [...chosen, value]
                            )
                        }
                    />
                    {/* ⚠️ THE LABEL IS TRANSLATED, THE VALUE IS NOT. The funnel filters on the
                        STORED status, so `value` must stay raw in every handler above — only the
                        word a person reads changes. A funnel offering "Mismatched" beside a table
                        column and a summary chip both saying "Not-Matched" would look like a
                        third status. */}
                    <span className="truncate">
                        {column.id === "row_status" ? rowStatusLabel(value) : value}
                    </span>
                </label>
            ))}
        </div>
    );
};

interface RowProps {
    row: OutflowImportRow;
    columns: OutflowColumn[];
    query: string;
    /** Whether the checkbox COLUMN exists on this page at all. */
    selectable: boolean;
    /** ⚠️ The row's OWN boolean, never the shared Set -- see the component docstring. */
    rowSelectable: boolean;
    /** ⚠️ The row's OWN boolean, never the shared Set -- see the component docstring. */
    selected: boolean;
    decided: boolean;
    /** ⚠️ The row's OWN string, for the same reason. A plain value, so `memo` compares it properly. */
    origin: DecisionOrigin;
    onToggleRow: (name: string) => void;
    onOpenDecision: (row: OutflowImportRow) => void;
    actionColumn?: TableActionColumn;
    onUnreconcile?: (row: OutflowImportRow) => void;
}

const Row = memo(function Row({
    row,
    columns,
    query,
    selectable,
    rowSelectable,
    selected,
    decided,
    origin,
    onToggleRow,
    onOpenDecision,
    actionColumn,
    onUnreconcile,
}: RowProps) {
    return (
        <tr className={`border-t ${selected ? "bg-primary/5" : "hover:bg-muted/40"}`}>
            {/* ⚠️ THE CELL IS ALWAYS RENDERED WHEN THE COLUMN EXISTS, empty for a row that cannot
                be ticked. Omitting the `<td>` instead would shift every later cell of that row one
                column left -- a settled row's Beneficiary landing under the checkbox header. */}
            {selectable && (
                <td className="px-2 py-1.5 align-top">
                    {rowSelectable && (
                        <Checkbox
                            checked={selected}
                            onCheckedChange={() => onToggleRow(row.name)}
                            aria-label={`Select ${row.beneficiary_name}`}
                        />
                    )}
                </td>
            )}
            {columns.map((column) => (
                <td
                    key={column.id}
                    className={`px-2 py-1.5 align-top ${
                        column.align === "right" ? "text-right tabular-nums" : ""
                    } ${column.mono ? "font-mono text-xs" : ""}`}
                >
                    <Cell
                        row={row}
                        column={column}
                        query={query}
                        decided={decided}
                        origin={origin}
                        onOpenDecision={onOpenDecision}
                        onUnreconcile={onUnreconcile}
                    />
                </td>
            ))}
            {actionColumn && <td className="px-2 py-1.5 align-top">{actionColumn.render(row)}</td>}
        </tr>
    );
});

const Cell = ({
    row,
    column,
    query,
    decided,
    origin,
    onOpenDecision,
    onUnreconcile,
}: {
    row: OutflowImportRow;
    column: OutflowColumn;
    query: string;
    decided: boolean;
    origin: DecisionOrigin;
    onOpenDecision: (row: OutflowImportRow) => void;
    onUnreconcile?: (row: OutflowImportRow) => void;
}) => {
    switch (column.id) {
        case "added_on":
            return <>{row.added_on ? formatDate(row.added_on.split(/[ T]/)[0]) : "—"}</>;

        case "beneficiary_name":
            return (
                <div className="min-w-0">
                    <div className="truncate font-medium">
                        <Highlight text={row.beneficiary_name} query={query} />
                    </div>
                    {/* a/c and IFSC beneath the name, per the signed-off screen -- they identify
                        the beneficiary and belong with it, not in two more default columns. */}
                    <div className="truncate font-mono text-[11px] text-muted-foreground">
                        {[row.bank_account, row.ifsc].filter(Boolean).join(" · ") || "—"}
                    </div>
                </div>
            );

        case "amount":
            // ⚠️ COLOURED BY DIRECTION -- red out, green in (owner, 2026-09-14) -- and that colour
            // is now the only per-row direction marker: the `Direction` column it replaced was
            // removed in the same change.
            //
            // A part-used line also says, under the figure, how much of it is reconciled against
            // records and how much still waits -- the wording the Payments table uses.
            {
                const part = partlyAllocatedFigures(row);
                const figure = (
                    <span className={amountToneClass(row)}>{formatToRoundedIndianRupee(row.amount)}</span>
                );
                if (!part) return figure;
                return (
                    <div className="tabular-nums">
                        <div>{figure}</div>
                        <div className="text-[10px] leading-tight">
                            <div className="text-green-700">{formatToRoundedIndianRupee(part.reconciled)} reconciled</div>
                            <div className="text-orange-600">{formatToRoundedIndianRupee(part.pending)} pending</div>
                        </div>
                    </div>
                );
            }

        case "remarks": {
            // ⚠️ WRAPPED, NOT CLIPPED (see `wrapRemarks`). `truncate` cut the narration to one line
            // with no `title` beneath it, so the tail was unrecoverable from the screen -- and the
            // part naming what a transfer was FOR is as often at the end as at the front. The full
            // string still rides the `title`, exactly as the Reference and Outcome cells do.
            const lines = wrapRemarks(row.remarks);
            if (!lines.length) return <>—</>;
            return (
                // ⚠️ WIDTH ON THE CONTENT, NOT THE COLUMN -- the same rule `OUTCOME_CELL_WIDTH`
                // documents below. This table is auto-layout, so a 64-character line would simply
                // widen the column and take the space from Reference, Status and Outcome.
                <div
                    className={`${REMARKS_CELL_WIDTH} break-words text-muted-foreground`}
                    title={row.remarks}
                >
                    {/* ⚠️ WRAP FIRST, HIGHLIGHT PER LINE. `highlightSegments` computes offsets over
                        the RAW string, so feeding it text with break characters already inserted
                        would shift every offset past the first break and mark the wrong
                        characters. The accepted consequence is that a hit STRADDLING a wrap
                        boundary renders as two <mark>s rather than one -- which is what a hit
                        spanning a line break looks like in any wrapped text. */}
                    {lines.map((line, index) => (
                        <span key={index} className="block">
                            <Highlight text={line} query={query} />
                        </span>
                    ))}
                </div>
            );
        }

        case "bank_reference_no": {
            // ⚠️ THE FULL VALUE STAYS REACHABLE, ON THE `title`. The visible text is the last 12
            // characters of a long reference (owner ruling) -- but this is the value that
            // reconciles a payment with the bank or the wallet, so it must never become
            // unrecoverable from the screen. `referenceValue` is also what `column.get` returns, so
            // the search box, the sort and the funnel all still see the whole string.
            const full = referenceValue(row);
            if (!full) return <>—</>;
            const shown = shortReference(full);
            return (
                <span title={full}>
                    <Highlight text={shown} query={query} />
                </span>
            );
        }

        case "row_status":
            // ⚠️ `rowStatusLabel`, NOT the raw value. `Mismatched` reads on screen as "Needs a
            // record" — the stored status is unchanged, and every filter and scope still sends the
            // stored string. Rendering the raw value here while the summary chip renders the phrase
            // is exactly the drift this shared helper exists to stop.
            return (
                <Badge variant="outline" className={`${rowStatusTone(row.row_status)} border-0`}>
                    {rowStatusLabel(row.row_status)}
                </Badge>
            );

        case "outcome":
            return (
                <OutcomeButton
                    row={row}
                    decided={decided}
                    origin={origin}
                    onOpenDecision={onOpenDecision}
                    onUnreconcile={onUnreconcile}
                />
            );

        case "skip_kind":
            return <SkipTypeCell row={row} />;

        case "import_batch":
            // The FILENAME is what a person recognises an import by; the batch id means nothing to
            // an accountant. It stays on the title so it is still recoverable when one is needed.
            return (
                <span className="block truncate text-xs text-muted-foreground" title={row.import_batch}>
                    {row.import_filename || row.import_batch || "—"}
                </span>
            );

        case "time":
            return <>{String(row.added_on ?? "").split(/[ T]/)[1]?.slice(0, 5) || "—"}</>;

        default:
            return <>{String(column.get(row) ?? "") || "—"}</>;
    }
};

/**
 * Kept in step with the `remarks` column's declared `width` (230px) minus the cell's own px-2
 * padding on each side. The column's width is the hint; this is the enforcement -- see the ruling
 * on `OUTCOME_CELL_WIDTH` below for why the hint alone does nothing in an auto-layout table.
 */
const REMARKS_CELL_WIDTH = "w-[214px]";

/**
 * ⚠️ A REAL BUTTON -- border, hover lift, chevron.
 *
 * The owner's complaint was that a clickable row does not read as clickable, and a hover tint does
 * not fix that: in a dense financial table a row that highlights on hover reads as a highlight,
 * not a button. This is the one saturated, unmistakably interactive element in the row.
 */
/**
 * Kept in step with the `outcome` column's declared `width` (220px) minus the cell's own px-2
 * padding on each side. The column's width is the hint; this is the enforcement.
 */
const OUTCOME_CELL_WIDTH = "w-[204px]";

const OutcomeButton = ({
    row,
    decided,
    origin,
    onOpenDecision,
    onUnreconcile,
}: {
    row: OutflowImportRow;
    decided: boolean;
    origin: DecisionOrigin;
    onOpenDecision: (row: OutflowImportRow) => void;
    onUnreconcile?: (row: OutflowImportRow) => void;
}) => {
    // ⚠️ READ THE SET, never re-spell it. This was two string literals, the one place in the
    // client that duplicated the terminal vocabulary -- so a change to the module could not reach
    // it. A `Partially Allocated` row must keep its Outcome button: it is frozen against
    // re-matching, but a person still owes it a decision.
    const terminal = TERMINAL_ROW_STATUSES.has(row.row_status);
    // The one reading of "which note does this line show" -- a hand skip shows its typed reason (#1273).
    const note = outcomeNoteOf(row);
    const links = rowSettlementLinks(row);
    const bankLineTargets = settledBankLineTargets(row);

    if (terminal) {
        // #1273: a hand skip says who and when, under the reason they typed.
        const byHand = skippedByHandLine(row);
        // #1275: a Settled line gets Unreconcile below its record links -- any source since #1314.
        const undo = unreconcileAffordance(row, Boolean(onUnreconcile));
        return (
            <div className={`${OUTCOME_CELL_WIDTH} space-y-1`}>
                <span className="block truncate text-xs text-muted-foreground" title={note}>
                    {note || "—"}
                </span>
                {byHand && (
                    <span className="block truncate text-[11px] text-muted-foreground/80" title={byHand}>
                        {byHand}
                    </span>
                )}
                {/* A Settled line opens each record's Bank lines in a dialog (owner ruling
                    2026-09-24); a payment keeps its PO / WO link beside it. Every other terminal
                    line keeps the plain record links. */}
                {bankLineTargets.length > 0
                    ? bankLineTargets.map((target) => (
                          <SettledRecordLine key={`${target.doctype}-${target.name}`} target={target} />
                      ))
                    : links.map((link) => <RecordLink key={`${link.href}-${link.label}`} link={link} />)}
                {undo === "button" && onUnreconcile && (
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1 px-2 text-xs"
                        onClick={() => onUnreconcile(row)}
                    >
                        <CornerUpLeft className="h-3.5 w-3.5 shrink-0" />
                        Unreconcile
                    </Button>
                )}
            </div>
        );
    }

    // ⚠️ THE WIDTH IS ENFORCED ON THE CELL CONTENT, NOT BY THE COLUMN'S `width` (owner, 2026-08-10).
    // This table is AUTO-LAYOUT, so `<th style={{width}}>` is only a HINT -- the browser widens any
    // column whose content demands it, and this cell's content is a whole sentence. `truncate` alone
    // cannot help either: with nothing bounding it, the cell grows and there is never any overflow
    // to cut. A fixed width on the content is what actually caps the column, and it is what makes
    // the `truncate` above do anything at all. The full sentence stays reachable on the `title`.
    // ⚠️ THE NOTE SITS ABOVE THE BUTTON, NOT INSIDE IT (owner, 2026-08-10). A control wrapped
    // around a whole sentence stops reading as a control -- it reads as a bordered paragraph, which
    // is exactly the complaint. Splitting them lets the button hold a VERB, which is what makes it
    // recognisable at a glance, and lets the column be narrow because the prose is no longer
    // competing with a border for the same width.
    //
    // ⚠️ THE SUGGESTED CASE STILL NAMES THE RECORD, and that is the difference between a claim and
    // a fact a reviewer can check. "Ready to confirm" on its own asks someone to trust the
    // software; naming PAY-00105-038 lets them tick the box without opening anything, which is the
    // entire point of pre-selecting. It moved lines; it did not go.
    const label = decided ? "Review" : origin === "suggested" ? "Confirm" : "Choose";
    // #1280: an unreconciled line says when, and whether the pick is the old one, under an amber chip.
    const byHand = confirmByHandNote(row);

    return (
        <div className={`${OUTCOME_CELL_WIDTH} space-y-1`}>
            {byHand && (
                <>
                    <p className="line-clamp-2 text-xs text-muted-foreground" title={byHand.text}>
                        {byHand.lead}
                        {byHand.pick && (
                            <>
                                {" "}
                                {byHand.pickLabel} <span className="font-mono">{byHand.pick}</span>
                            </>
                        )}
                    </p>
                    <span className="inline-block rounded border border-amber-300 bg-amber-50 px-1.5 py-px text-[11px] font-medium text-amber-900">
                        {CONFIRM_BY_HAND_CHIP}
                    </span>
                </>
            )}
            {!byHand && (
                <p className="truncate text-xs text-muted-foreground" title={note || undefined}>
                    {origin === "suggested" ? (
                        <>
                            Matched <span className="font-mono">{row.suggested_name}</span>
                        </>
                    ) : decided ? (
                        "Decided"
                    ) : (
                        note || "Nothing matched yet"
                    )}
                </p>
            )}

            <div className="flex items-center gap-1.5">
                {/* A filled, bordered control with a verb and a chevron. The previous version was
                    `bg-background` on a white table, so the only thing distinguishing it from the
                    cell around it was a hairline border -- invisible in a dense financial grid. */}
                <button
                    type="button"
                    onClick={() => onOpenDecision(row)}
                    className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium shadow-sm transition-colors ${
                        decided
                            ? "border-emerald-300 bg-emerald-100 text-emerald-900 hover:bg-emerald-200"
                            : "border-input bg-secondary text-secondary-foreground hover:bg-accent hover:text-accent-foreground"
                    }`}
                >
                    {label}
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-70" />
                </button>

                {/* ⚠️ BESIDE THE BUTTON, NEVER INSIDE IT. An <a> nested in a <button> is invalid
                    HTML, and the click target would be ambiguous: the button opens the decision
                    dialog, the link navigates away from the batch. Two actions, two elements. */}
                {origin === "suggested" &&
                    links.map((link) => (
                        <RecordLink key={`${link.href}-${link.label}`} link={link} iconOnly />
                    ))}
            </div>
        </div>
    );
};

/**
 * A link to the record an import row points at.
 *
 * ⚠️ AN INEXACT LINK SAYS SO. A payment link lands on the record itself; an expense link can only
 * reach the list it lives in, because neither expense table can be searched by record id. Rendering
 * both identically would promise a precision one of them does not have, and the reader would only
 * discover the difference by clicking and hunting.
 */
/**
 * The Skipped popup's Skip Type cell: the kind, the document behind the skip, and a hover card with that
 * document's facts and the full reason (owner, 2026-09-17). Record links stay below, as under Outcome.
 *
 * ⚠️ THE CARD IS PORTALLED. The popup's table sits in an `overflow-auto` box, and an in-place card would
 * be clipped by it at the table's right and bottom edges -- exactly where this column lives.
 */
const SkipTypeCell = ({ row }: { row: OutflowImportRow }) => {
    const summary = skipSourceSummary(row);
    const links = rowSettlementLinks(row);
    return (
        <div className={`${OUTCOME_CELL_WIDTH} space-y-1`}>
            <HoverCard openDelay={150}>
                <HoverCardTrigger asChild>
                    <button type="button" className="block w-full cursor-help text-left">
                        <span className="block truncate text-xs font-medium underline decoration-dotted underline-offset-2">
                            {row.skip_kind || "—"}
                        </span>
                        {summary.reference && (
                            <span className="block truncate text-[11px] text-muted-foreground">
                                {summary.reference}
                            </span>
                        )}
                    </button>
                </HoverCardTrigger>
                {summary.groups.length > 0 && (
                    <HoverCardPrimitive.Portal>
                        <HoverCardContent side="left" className="z-[60] w-80 space-y-3 p-3 text-xs">
                            {summary.groups.map((group, index) => (
                                <div key={index} className="space-y-1">
                                    {group.title && <p className="font-medium text-foreground">{group.title}</p>}
                                    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                                        {group.facts.map((fact) => (
                                            <FactRow key={fact.label} label={fact.label} value={fact.value} />
                                        ))}
                                    </dl>
                                </div>
                            ))}
                        </HoverCardContent>
                    </HoverCardPrimitive.Portal>
                )}
            </HoverCard>
            {links.map((link) => (
                <RecordLink key={`${link.href}-${link.label}`} link={link} />
            ))}
        </div>
    );
};

/**
 * One record a Settled line wrote to: its name, the PO / WO link for a payment, and "Bank lines",
 * which opens every bank line linked to that record in a dialog (owner ruling 2026-09-24).
 *
 * ⚠️ AN EXPENSE GETS NO NAVIGATION LINK, only the dialog -- neither expense list can land on a
 * record (see `settlementLink`). The dialog is the reader's way to see the record.
 */
const SettledRecordLine = ({ target }: { target: SettledBankLineTarget }) => {
    const [open, setOpen] = useState(false);
    return (
        <div className="flex min-w-0 items-center gap-1">
            {target.link ? (
                <RecordLink link={target.link} />
            ) : (
                <span className="truncate px-1 py-0.5 font-mono text-[11px]" title={target.name}>
                    {target.name}
                </span>
            )}
            <button
                type="button"
                onClick={() => setOpen(true)}
                title={`See every bank line linked to ${target.name}`}
                className="inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[11px] text-primary hover:underline"
            >
                <Landmark className="h-3 w-3 shrink-0" />
                Bank lines
            </button>
            <ExpenseBankLinesDialog
                open={open}
                onOpenChange={setOpen}
                doctype={target.doctype}
                name={target.name}
                subtitle={target.orderName || target.doctype}
            />
        </div>
    );
};

const FactRow = ({ label, value }: { label: string; value: string }) => (
    <>
        <dt className="text-muted-foreground">{label}</dt>
        <dd className="break-words">{value}</dd>
    </>
);

const RecordLink = ({ link, iconOnly = false }: { link: SettlementLink; iconOnly?: boolean }) => (
    <Link
        to={link.href}
        title={link.title}
        className={`inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[11px] text-primary hover:underline ${
            iconOnly ? "mt-1.5" : ""
        }`}
    >
        {!iconOnly && <span className="truncate font-mono">{link.label}</span>}
        {link.exact ? (
            <ExternalLink className="h-3 w-3 shrink-0" />
        ) : (
            <List className="h-3 w-3 shrink-0 opacity-70" />
        )}
    </Link>
);

/** Search hits marked in the cell. Segments come from the pure, unit-tested model. */
const Highlight = ({ text, query }: { text: string | null | undefined; query: string }) => {
    const segments = highlightSegments(text, query);
    if (!segments.length) return <>—</>;
    return (
        <>
            {segments.map((segment, index) =>
                segment.hit ? (
                    <mark key={index} className="rounded-sm bg-amber-200 text-inherit">
                        {segment.text}
                    </mark>
                ) : (
                    <span key={index}>{segment.text}</span>
                )
            )}
        </>
    );
};

/**
 * Paging for the master table (slice X3).
 *
 * ⚠️ IT STATES THE RANGE AND THE TOTAL, not just "next / previous". A person working a statement
 * needs to know whether the twelve rows in front of them are all of the open work or the first
 * twelve of two hundred -- and with a filtered, paged table there is no other way to tell.
 */
export const TablePagination = ({
    total,
    limit,
    offset,
    busy,
    onPage,
}: {
    total: number;
    limit: number;
    offset: number;
    busy?: boolean;
    onPage: (page: number) => void;
}) => {
    if (total <= limit) return null;
    const page = Math.floor(offset / limit);
    const pages = Math.ceil(total / limit);
    const first = offset + 1;
    const last = Math.min(offset + limit, total);

    return (
        <div className="flex items-center justify-between px-1 py-2 text-sm text-muted-foreground">
            <span>
                {first.toLocaleString()}–{last.toLocaleString()} of {total.toLocaleString()}
            </span>
            <div className="flex items-center gap-2">
                <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0 || busy}
                    onClick={() => onPage(page - 1)}
                >
                    Previous
                </Button>
                <span className="tabular-nums">
                    {page + 1} / {pages}
                </span>
                <Button
                    variant="outline"
                    size="sm"
                    disabled={page + 1 >= pages || busy}
                    onClick={() => onPage(page + 1)}
                >
                    Next
                </Button>
            </div>
        </div>
    );
};

export const ClearFiltersButton = ({
    count,
    onClear,
}: {
    count: number;
    onClear: () => void;
}) =>
    count > 0 ? (
        <Button variant="ghost" size="sm" onClick={onClear}>
            <X className="mr-1 h-3.5 w-3.5" />
            Clear filters ({count})
        </Button>
    ) : null;
