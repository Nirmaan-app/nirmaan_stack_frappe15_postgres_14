import * as React from "react";
import { CheckIcon } from "@radix-ui/react-icons";
import { Filter, FilterX } from "lucide-react";

import { cn } from "@/lib/utils";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { urlStateManager } from "@/utils/urlStateManager";

// ─────────────────────────────────────────────────────────────────────────────
// Column filters for DERIVED columns on the TDS Items master — columns whose
// value is computed from a DIFFERENT table, so there is no field to filter on:
//
//   • Linked Item SKU    — membership lives on `Items.linked_tds_item`
//   • Repository Entries — makes live on `TDS Repository.make`
//
// WHY THIS IS NOT `DataTableFacetedFilter`. That component is bound to a
// TanStack column: it reads/writes `column.getFilterValue()`, which the table
// hook round-trips to the backend as `[column.id, "in", [...]]`. That only
// works for a column backed by a real doctype FIELD. Putting these selections
// into `columnFilters` would send the server a filter on a column that does not
// exist. So the selection is kept out of the table's filter state entirely and
// the page translates it into a `name in [...]` narrowing instead.
//
// This is LOCAL on purpose. The two filters above are near-twins of EACH OTHER,
// which is what earns this one shared component — but they are twins of each
// other, NOT of the column-bound one. If a third derived facet appears OUTSIDE
// this page, extract the presentation (trigger + popover + rows) into something
// both this and `DataTableFacetedFilter` compose; do not widen either one into
// a two-mode component.
//
// ⚠️ THIS CONTROL OWNS ITS OWN STATE, AND THAT IS LOAD-BEARING — DO NOT
// "SIMPLIFY" IT INTO A CONTROLLED value/onChange PAIR DRIVEN BY THE PAGE.
// It renders inside a column's `header`, and a column `header` is handed to
// React by `flexRender` as the ELEMENT TYPE (`<Comp {...ctx}/>`). Threading the
// selection down as props means the page's `columns` useMemo has to list it as
// a dependency, so every click rebuilds `columns` -> a new header function
// identity -> React sees a different element type -> it UNMOUNTS and remounts
// the header, taking the open Popover with it. The symptom is that the popover
// slams shut after one click and MULTI-SELECT IS IMPOSSIBLE.
//
// The page still needs the selection (to narrow the query). It reads it by
// subscribing to the SAME url param via `useDerivedFacetParam` — `urlStateManager`
// notifies every subscriber of a key, so the two stay in step without the page
// ever owning the value.
// ─────────────────────────────────────────────────────────────────────────────

export interface DerivedFacetOption {
    label: string;
    value: string;
    /**
     * How many TABLE ROWS this option would leave — i.e. TDS Items, not entries.
     * It is the number the user sees in the toolbar after ticking it. Rendered
     * as `Label (N)`, the same shape every other facet in the app uses.
     *
     * ⚠️ UNSCOPED. It is computed from the whole dataset, so it does NOT shrink
     * when the Work Package facet or the search box is also active — unlike a
     * real backend facet, which cross-filters. Cross-filtering these would need
     * the server to understand the dimension (it currently cannot, which is why
     * this control exists at all). Omit `count` rather than show a wrong one.
     */
    count?: number;
}

/**
 * Read/write a comma-joined multi-select stored in one url param, synced through
 * `urlStateManager`.
 *
 * NOT `useStateSyncedWithParams`: that writes through react-router, whose
 * `useSearchParams` snapshot never sees the params the data-table writes with
 * `history.replaceState`. Writing through it would rebuild the query string
 * from that stale snapshot and silently drop the live search / Work Package
 * facet / sort from the URL on every click of these filters.
 *
 * Safe to call from several components at once — a write notifies every
 * subscriber of the key, which is exactly how a filter control and the page
 * share a value without either owning it.
 */
export function useDerivedFacetParam(paramKey: string) {
    const [raw, setRaw] = React.useState<string>(
        () => urlStateManager.getParam(paramKey) ?? ""
    );

    React.useEffect(
        () => urlStateManager.subscribe(paramKey, (_, v) => setRaw(v ?? "")),
        [paramKey]
    );

    const values = React.useMemo(() => raw.split(",").filter(Boolean), [raw]);

    const setValues = React.useCallback(
        (next: string[]) => {
            const joined = next.join(",");
            setRaw(joined);
            // `null` (not "") so the param is REMOVED rather than left empty.
            urlStateManager.updateParam(paramKey, joined || null);
        },
        [paramKey]
    );

    return { raw, values, setValues };
}

interface DerivedFacetFilterProps {
    options: DerivedFacetOption[];
    /** The `urlStateManager` param key this control owns. */
    paramKey: string;
    /** Popover placeholder + trigger tooltip. */
    title: string;
    /**
     * Show a search box. OFF by default — Linked Item SKU has two fixed options
     * and a search box over two rows is noise. Make has ~120 and needs one.
     */
    searchable?: boolean;
}

export function DerivedFacetFilter({
    options,
    paramKey,
    title,
    searchable = false,
}: DerivedFacetFilterProps) {
    const { values, setValues } = useDerivedFacetParam(paramKey);
    const selected = React.useMemo(() => new Set(values), [values]);

    const toggle = (optionValue: string) => {
        const next = new Set(selected);
        if (next.has(optionValue)) next.delete(optionValue);
        else next.add(optionValue);
        // Order by the declared options so the param reads the same regardless
        // of which one was ticked first (stable, shareable URLs).
        setValues(options.map((o) => o.value).filter((v) => next.has(v)));
    };

    return (
        <Popover>
            <PopoverTrigger asChild>
                <div
                    className={cn(
                        "cursor-pointer hover:bg-gray-100 px-1 py-1 rounded-md",
                        selected.size > 0 && "bg-gray-200"
                    )}
                    title={`Filter by ${title}`}
                >
                    {selected.size > 0 ? (
                        <FilterX className="text-primary h-4 w-4 animate-bounce" />
                    ) : (
                        <Filter className="text-primary h-4 w-4" />
                    )}
                </div>
            </PopoverTrigger>
            <PopoverContent className="w-[220px] p-0" align="start">
                <Command>
                    {searchable && <CommandInput placeholder={title} />}
                    <CommandList>
                        <CommandEmpty>
                            {options.length === 0 ? "No options available" : "No results found."}
                        </CommandEmpty>
                        <CommandGroup>
                            {options.map((option) => {
                                const isSelected = selected.has(option.value);
                                return (
                                    <CommandItem
                                        key={option.value}
                                        onSelect={() => toggle(option.value)}
                                    >
                                        <div
                                            className={cn(
                                                "mr-2 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-primary",
                                                isSelected
                                                    ? "bg-primary text-primary-foreground"
                                                    : "opacity-50 [&_svg]:invisible"
                                            )}
                                        >
                                            <CheckIcon className="h-4 w-4" />
                                        </div>
                                        {/* Count is baked INTO the label, matching
                                            every other facet in the app — see
                                            `useFacetValues.ts` ("Show count in
                                            label"). Not right-aligned in its own
                                            span, and not truncated: a long label
                                            wraps and keeps its count with it. */}
                                        <span>
                                            {option.count === undefined
                                                ? option.label
                                                : `${option.label} (${option.count})`}
                                        </span>
                                    </CommandItem>
                                );
                            })}
                        </CommandGroup>
                    </CommandList>
                </Command>
                {/* OUTSIDE CommandList on purpose: the list scrolls (capped at
                    300px), and a Clear you have to scroll 120 makes to reach is
                    not a Clear. A plain button, not a CommandItem, so cmdk's
                    search never filters the escape hatch out of existence. */}
                {selected.size > 0 && (
                    <button
                        type="button"
                        onClick={() => setValues([])}
                        className="w-full border-t py-2 text-center text-sm hover:bg-accent"
                    >
                        Clear filters
                    </button>
                )}
            </PopoverContent>
        </Popover>
    );
}
