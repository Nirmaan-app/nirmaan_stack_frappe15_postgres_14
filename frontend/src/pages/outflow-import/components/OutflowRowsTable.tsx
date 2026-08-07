// src/pages/outflow-import/components/OutflowRowsTable.tsx

import { memo, useMemo } from "react";
import { ArrowDown, ArrowUp, ChevronRight, Filter, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { OutflowImportRow } from "@/types/NirmaanStack/OutflowImportBatch";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import { rowStatusTone } from "../outflowImportStatus";
import {
    OUTFLOW_COLUMNS,
    facetValues,
    highlightSegments,
    type ColumnFilters,
    type DecisionOrigin,
    type OutflowColumn,
    type RangeFilter,
    type SortState,
} from "../outflowTableModel";

interface Props {
    rows: OutflowImportRow[];
    /** Unfiltered rows for this tab -- facet lists must offer every value, not only visible ones. */
    facetSource: OutflowImportRow[];
    query: string;
    filters: ColumnFilters;
    sort: SortState;
    hiddenColumns: ReadonlySet<string>;
    selected: ReadonlySet<string>;
    decidedRowNames: ReadonlySet<string>;
    /** Whether each row's decision came from the match run or from a person. */
    originByRow: ReadonlyMap<string, DecisionOrigin>;
    selectable: boolean;
    onSort: (columnId: string) => void;
    onFilter: (columnId: string, value: ColumnFilters[string]) => void;
    onToggleRow: (name: string) => void;
    onToggleAll: (names: string[]) => void;
    onOpenDecision: (row: OutflowImportRow) => void;
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
    facetSource,
    query,
    filters,
    sort,
    hiddenColumns,
    selected,
    decidedRowNames,
    originByRow,
    selectable,
    onSort,
    onFilter,
    onToggleRow,
    onToggleAll,
    onOpenDecision,
}: Props) => {
    const columns = useMemo(
        () => OUTFLOW_COLUMNS.filter((c) => !hiddenColumns.has(c.id)),
        [hiddenColumns]
    );
    const names = useMemo(() => rows.map((r) => r.name), [rows]);
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
                                facetSource={facetSource}
                                onSort={onSort}
                                onFilter={onFilter}
                            />
                        ))}
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
                            selected={selected.has(row.name)}
                            decided={decidedRowNames.has(row.name)}
                            origin={originByRow.get(row.name) ?? "none"}
                            onToggleRow={onToggleRow}
                            onOpenDecision={onOpenDecision}
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
    facetSource,
    onSort,
    onFilter,
}: {
    column: OutflowColumn;
    sort: SortState;
    filters: ColumnFilters;
    facetSource: OutflowImportRow[];
    onSort: (columnId: string) => void;
    onFilter: (columnId: string, value: ColumnFilters[string]) => void;
}) => {
    const sorted = sort.columnId === column.id;
    const filter = filters[column.id];
    const active = Array.isArray(filter)
        ? filter.length > 0
        : typeof filter === "string"
          ? filter.trim().length > 0
          : Boolean(
                filter &&
                    ((filter as RangeFilter).min != null || (filter as RangeFilter).max != null)
            );

    return (
        <th
            style={{ width: column.width }}
            className={`px-2 py-2 text-left font-medium ${column.align === "right" ? "text-right" : ""}`}
        >
            <div className="flex items-center gap-1">
                {column.filter === "none" ? (
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

                {column.filter !== "none" && (
                    <Popover>
                        <PopoverTrigger asChild>
                            <button
                                type="button"
                                aria-label={`Filter ${column.title}`}
                                className={`rounded p-0.5 ${
                                    active
                                        ? "text-primary"
                                        : "text-muted-foreground/50 hover:text-muted-foreground"
                                }`}
                            >
                                <Filter className="h-3 w-3" />
                            </button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-64 p-3">
                            <ColumnFilterBody
                                column={column}
                                filter={filter}
                                facetSource={facetSource}
                                onFilter={onFilter}
                            />
                        </PopoverContent>
                    </Popover>
                )}
            </div>
        </th>
    );
};

const ColumnFilterBody = ({
    column,
    filter,
    facetSource,
    onFilter,
}: {
    column: OutflowColumn;
    filter: ColumnFilters[string];
    facetSource: OutflowImportRow[];
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

    // Facet. Values come from the UNFILTERED tab rows, so a value never disappears from its own
    // filter list the moment it is unticked -- which would make the filter impossible to undo.
    const chosen = (filter as string[]) ?? [];
    const values = facetValues(facetSource, column);
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
                    <span className="truncate">{value}</span>
                </label>
            ))}
        </div>
    );
};

interface RowProps {
    row: OutflowImportRow;
    columns: OutflowColumn[];
    query: string;
    selectable: boolean;
    /** ⚠️ The row's OWN boolean, never the shared Set -- see the component docstring. */
    selected: boolean;
    decided: boolean;
    /** ⚠️ The row's OWN string, for the same reason. A plain value, so `memo` compares it properly. */
    origin: DecisionOrigin;
    onToggleRow: (name: string) => void;
    onOpenDecision: (row: OutflowImportRow) => void;
}

const Row = memo(function Row({
    row,
    columns,
    query,
    selectable,
    selected,
    decided,
    origin,
    onToggleRow,
    onOpenDecision,
}: RowProps) {
    return (
        <tr className={`border-t ${selected ? "bg-primary/5" : "hover:bg-muted/40"}`}>
            {selectable && (
                <td className="px-2 py-1.5 align-top">
                    <Checkbox
                        checked={selected}
                        onCheckedChange={() => onToggleRow(row.name)}
                        aria-label={`Select ${row.beneficiary_name}`}
                    />
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
                    />
                </td>
            ))}
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
}: {
    row: OutflowImportRow;
    column: OutflowColumn;
    query: string;
    decided: boolean;
    origin: DecisionOrigin;
    onOpenDecision: (row: OutflowImportRow) => void;
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
            return <>{formatToRoundedIndianRupee(row.amount)}</>;

        case "remarks":
            return (
                <span className="block truncate text-muted-foreground">
                    <Highlight text={row.remarks} query={query} />
                </span>
            );

        case "bank_reference_no":
            return <Highlight text={row.bank_reference_no} query={query} />;

        case "row_status":
            return (
                <Badge variant="outline" className={`${rowStatusTone(row.row_status)} border-0`}>
                    {row.row_status}
                </Badge>
            );

        case "outcome":
            return (
                <OutcomeButton
                    row={row}
                    decided={decided}
                    origin={origin}
                    onOpenDecision={onOpenDecision}
                />
            );

        case "time":
            return <>{String(row.added_on ?? "").split(/[ T]/)[1]?.slice(0, 5) || "—"}</>;

        default:
            return <>{String(column.get(row) ?? "") || "—"}</>;
    }
};

/**
 * ⚠️ A REAL BUTTON -- border, hover lift, chevron.
 *
 * The owner's complaint was that a clickable row does not read as clickable, and a hover tint does
 * not fix that: in a dense financial table a row that highlights on hover reads as a highlight,
 * not a button. This is the one saturated, unmistakably interactive element in the row.
 */
const OutcomeButton = ({
    row,
    decided,
    origin,
    onOpenDecision,
}: {
    row: OutflowImportRow;
    decided: boolean;
    origin: DecisionOrigin;
    onOpenDecision: (row: OutflowImportRow) => void;
}) => {
    const terminal = row.row_status === "Settled" || row.row_status === "Skipped";
    const note = row.outcome_note || row.skip_reason || "";

    if (terminal) {
        return <span className="block text-xs text-muted-foreground">{note || "—"}</span>;
    }

    return (
        <button
            type="button"
            onClick={() => onOpenDecision(row)}
            className={`flex w-full items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs shadow-sm transition-all hover:-translate-y-px hover:shadow ${
                decided
                    ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                    : "border-muted-foreground/30 bg-background"
            }`}
        >
            {/* ⚠️ THE SUGGESTED CASE NAMES THE RECORD, and that is the difference between a claim
                and a fact a reviewer can check. "Ready to confirm" on its own asks someone to
                trust the software; naming PAY-00105-038 lets them tick the box without opening
                anything, which is the entire point of pre-selecting. */}
            <span className="min-w-0 flex-1 truncate">
                {origin === "suggested" ? (
                    <>
                        Matched <span className="font-mono">{row.suggested_name}</span> — tick to
                        confirm
                    </>
                ) : decided ? (
                    "Decided — ready to confirm"
                ) : (
                    note || "Choose what this settled"
                )}
            </span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </button>
    );
};

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
