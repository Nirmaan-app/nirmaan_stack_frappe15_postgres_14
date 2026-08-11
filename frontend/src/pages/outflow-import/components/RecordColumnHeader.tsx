// src/pages/outflow-import/components/RecordColumnHeader.tsx

/**
 * A sortable, filterable column header for the Resolve dialog's Link-payment table (slice N1).
 *
 * ⚠️ DELIBERATE DUPLICATION, NOT DRIFT. This is a SIBLING of `boq-wizard/GridColumnFilter.tsx` and
 * of `RateMasterDataViewer`'s `ColumnFilter`, not an import of either. The owner ruled on that
 * pattern once already: exporting one of them would couple modules that are independent, and the
 * three have genuinely different needs. This one carries RANGE filters (amount, date) that neither
 * sibling has any use for, and it merges the sort control into the same header cell.
 *
 * ⚠️ THE TYPE-TO-SEARCH BOX IS LOCAL STATE INSIDE THE POPOVER AND MUST STAY THERE. Lifting it to
 * the dialog would re-render the whole record table on every keystroke -- which is precisely the
 * per-keystroke work slice N1 removed by loading the pool once. Only a committed change (ticking a
 * value, applying a range) raises `onChange`, because only that changes the row set.
 *
 * ⚠️ THE DRAFT RANGE IS ALSO LOCAL, AND IT APPLIES ON A BUTTON. A range that filtered on every
 * keystroke would empty the table halfway through typing "10000" -- at "1", every record above ten
 * rupees vanishes. Typing a bound is not the same act as meaning it.
 */

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Filter } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import {
    BLANK_FACET_ID,
    parseAmountBound,
    type FacetOption,
    type RecordSort,
    type RecordSortColumn,
} from "../recordPickerView";

type FilterSpec =
    | {
          kind: "facet";
          options: readonly FacetOption[];
          selected: ReadonlySet<string>;
          onChange: (next: ReadonlySet<string>) => void;
      }
    | {
          kind: "amount";
          min: number | null;
          max: number | null;
          onChange: (min: number | null, max: number | null) => void;
      }
    | {
          kind: "date";
          from: string | null;
          to: string | null;
          onChange: (from: string | null, to: string | null) => void;
      };

interface Props {
    title: string;
    column: RecordSortColumn;
    sort: RecordSort | null;
    onSort: (column: RecordSortColumn) => void;
    filter: FilterSpec;
    align?: "right";
}

export const RecordColumnHeader = ({ title, column, sort, onSort, filter, align }: Props) => {
    const sorted = sort?.column === column ? sort.dir : null;

    return (
        <div
            className={cn(
                "flex items-center gap-1",
                align === "right" ? "justify-end" : "justify-start"
            )}
        >
            <button
                type="button"
                onClick={() => onSort(column)}
                // The title says what the NEXT click does, because a tri-state control whose third
                // state is "back to the ranking" is not guessable from an arrow.
                title={
                    sorted === null
                        ? `Sort by ${title}`
                        : sorted === "asc"
                          ? `Sort by ${title}, descending`
                          : `Clear the sort and return to the suggested order`
                }
                className="inline-flex items-center gap-1 rounded text-[11px] font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
                {title}
                {sorted === "asc" ? (
                    <ArrowUp className="h-3 w-3 shrink-0 text-blue-600 dark:text-blue-400" />
                ) : sorted === "desc" ? (
                    <ArrowDown className="h-3 w-3 shrink-0 text-blue-600 dark:text-blue-400" />
                ) : (
                    <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-40" />
                )}
            </button>
            <ColumnFilterPopover title={title} filter={filter} />
        </div>
    );
};

const filterIsActive = (filter: FilterSpec): boolean => {
    if (filter.kind === "facet") return filter.selected.size > 0;
    if (filter.kind === "amount") return filter.min !== null || filter.max !== null;
    return Boolean(filter.from || filter.to);
};

const ColumnFilterPopover = ({ title, filter }: { title: string; filter: FilterSpec }) => {
    const [open, setOpen] = useState(false);
    const active = filterIsActive(filter);

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    aria-label={`Filter ${title}`}
                    title={`Filter ${title}`}
                    // `h-4` + `leading-none`: the active-state count badge is taller than the bare
                    // icon, and a header row that changes height when a filter goes active makes
                    // the table jump under the reader's eye. Cheap to pin, awkward to notice.
                    className={cn(
                        "inline-flex h-4 shrink-0 items-center gap-0.5 rounded px-0.5 leading-none text-muted-foreground/70 transition-colors hover:text-foreground focus:outline-none focus:ring-1 focus:ring-ring",
                        active && "text-blue-600 dark:text-blue-400"
                    )}
                >
                    <Filter className="h-3 w-3 shrink-0" />
                    {filter.kind === "facet" && active && (
                        <span className="text-[9px] font-semibold leading-none tabular-nums">
                            {filter.selected.size}
                        </span>
                    )}
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-2">
                {filter.kind === "facet" ? (
                    <FacetBody title={title} filter={filter} />
                ) : (
                    <RangeBody filter={filter} onApplied={() => setOpen(false)} />
                )}
            </PopoverContent>
        </Popover>
    );
};

const FacetBody = ({
    title,
    filter,
}: {
    title: string;
    filter: Extract<FilterSpec, { kind: "facet" }>;
}) => {
    const [q, setQ] = useState(""); // LOCAL -- see the header note.
    const shown = useMemo(() => {
        const needle = q.trim().toLowerCase();
        return needle
            ? filter.options.filter((o) => o.label.toLowerCase().includes(needle))
            : filter.options;
    }, [filter.options, q]);

    const toggle = (id: string) => {
        const next = new Set(filter.selected);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        filter.onChange(next);
    };

    const allShownSelected = shown.length > 0 && shown.every((o) => filter.selected.has(o.id));
    const toggleAllShown = () => {
        const next = new Set(filter.selected);
        if (allShownSelected) for (const o of shown) next.delete(o.id);
        else for (const o of shown) next.add(o.id);
        filter.onChange(next);
    };

    return (
        <>
            <Input
                autoFocus
                className="h-7 text-xs"
                placeholder={`Search ${title.toLowerCase()}…`}
                value={q}
                onChange={(e) => setQ(e.target.value)}
            />
            {shown.length > 0 && (
                <button
                    type="button"
                    className="mt-2 w-full rounded border px-2 py-1 text-left text-[11px] text-muted-foreground hover:bg-muted"
                    onClick={toggleAllShown}
                >
                    {allShownSelected ? "Clear all shown" : "Select all shown"}
                </button>
            )}
            <div className="mt-1 max-h-56 space-y-0.5 overflow-y-auto">
                {shown.length === 0 && (
                    <div className="px-1 py-2 text-xs text-muted-foreground">No values.</div>
                )}
                {shown.map((option) => (
                    <label
                        key={option.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-muted"
                    >
                        <input
                            type="checkbox"
                            checked={filter.selected.has(option.id)}
                            onChange={() => toggle(option.id)}
                        />
                        <span
                            className={cn(
                                "truncate",
                                option.id === BLANK_FACET_ID && "italic text-muted-foreground"
                            )}
                            title={option.label}
                        >
                            {option.label}
                        </span>
                    </label>
                ))}
            </div>
            {filter.selected.size > 0 && (
                <button
                    type="button"
                    className="mt-2 w-full rounded border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                    onClick={() => filter.onChange(new Set())}
                >
                    Clear ({filter.selected.size})
                </button>
            )}
        </>
    );
};

/**
 * Two bounds and an Apply.
 *
 * ⚠️ APPLY, NOT LIVE. Filtering on each keystroke empties the table mid-number: typing `10000` into
 * a minimum passes through `1`, at which point almost every record is excluded and the reviewer is
 * watching the list they are trying to narrow disappear. The draft is local until they commit it.
 */
const RangeBody = ({
    filter,
    onApplied,
}: {
    filter: Extract<FilterSpec, { kind: "amount" } | { kind: "date" }>;
    onApplied: () => void;
}) => {
    const isAmount = filter.kind === "amount";
    const initialLow = isAmount ? (filter.min ?? "") : (filter.from ?? "");
    const initialHigh = isAmount ? (filter.max ?? "") : (filter.to ?? "");

    const [low, setLow] = useState(String(initialLow));
    const [high, setHigh] = useState(String(initialHigh));

    // Re-seed when the applied value changes underneath -- e.g. after Clear filters, so reopening
    // the popover does not show a bound that is no longer in force.
    useEffect(() => {
        setLow(String(initialLow));
        setHigh(String(initialHigh));
    }, [initialLow, initialHigh]);

    const apply = () => {
        if (isAmount) filter.onChange(parseAmountBound(low), parseAmountBound(high));
        else filter.onChange(low.trim() || null, high.trim() || null);
        onApplied();
    };

    const clear = () => {
        setLow("");
        setHigh("");
        if (isAmount) filter.onChange(null, null);
        else filter.onChange(null, null);
        onApplied();
    };

    return (
        <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                    <span className="block text-[11px] text-muted-foreground">
                        {isAmount ? "Minimum" : "From"}
                    </span>
                    <Input
                        autoFocus
                        type={isAmount ? "text" : "date"}
                        inputMode={isAmount ? "decimal" : undefined}
                        className="h-7 text-xs"
                        value={low}
                        onChange={(e) => setLow(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && apply()}
                    />
                </label>
                <label className="space-y-1">
                    <span className="block text-[11px] text-muted-foreground">
                        {isAmount ? "Maximum" : "To"}
                    </span>
                    <Input
                        type={isAmount ? "text" : "date"}
                        inputMode={isAmount ? "decimal" : undefined}
                        className="h-7 text-xs"
                        value={high}
                        onChange={(e) => setHigh(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && apply()}
                    />
                </label>
            </div>
            {/* Leaving a box empty means "no bound on that side", which is worth saying: an empty
                minimum reading as zero is the exact trap `parseAmountBound` is written against. */}
            <p className="text-[11px] text-muted-foreground">Leave a box empty for no limit.</p>
            <div className="flex gap-2">
                <Button size="sm" className="h-7 flex-1 text-xs" onClick={apply}>
                    Apply
                </Button>
                <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={clear}
                    disabled={!filterIsActive(filter) && !low && !high}
                >
                    Clear
                </Button>
            </div>
        </div>
    );
};
