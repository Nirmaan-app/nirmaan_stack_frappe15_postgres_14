import * as React from "react";
import { CheckIcon } from "@radix-ui/react-icons";
import { Filter, FilterX } from "lucide-react";

import { cn } from "@/lib/utils";
import {
    Command,
    CommandGroup,
    CommandItem,
    CommandList,
    CommandSeparator,
} from "@/components/ui/command";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { urlStateManager } from "@/utils/urlStateManager";

// ─────────────────────────────────────────────────────────────────────────────
// The "Linked Item SKU" column filter on the TDS Items master.
//
// WHY THIS IS NOT `DataTableFacetedFilter`. That component is bound to a
// TanStack column: it reads/writes `column.getFilterValue()`, which the table
// hook round-trips to the backend as `[column.id, "in", [...]]`. That only
// works for a column backed by a real doctype FIELD. "Linked Item SKU" is a
// DERIVED count — membership lives on `Items.linked_tds_item`, not on
// `TDS Items` — so putting this selection into `columnFilters` would send the
// server a filter on a column that does not exist.
//
// Bending the shared component to accept a controlled value would touch every
// faceted filter in the app for the sake of one derived column here, so this
// is a local, self-contained twin instead: same trigger, same popover, same
// checkbox rows. It is deliberately NOT generic — a second derived facet
// elsewhere should be its own thing, or a real shared abstraction designed on
// purpose rather than this one widened by accident.
//
// ⚠️ THIS CONTROL OWNS ITS OWN STATE, AND THAT IS LOAD-BEARING — DO NOT
// "SIMPLIFY" IT BACK INTO A CONTROLLED value/onChange PAIR DRIVEN BY THE PAGE.
// It renders inside a column's `header`, and a column `header` is handed to
// React by `flexRender` as the ELEMENT TYPE (`<Comp {...ctx}/>`). Threading the
// selection down as props means the page's `columns` useMemo has to list it as
// a dependency, so every click rebuilds `columns` -> a new header function
// identity -> React sees a different element type -> it UNMOUNTS and remounts
// the header, taking the open Popover with it. The symptom is that the popover
// slams shut after one click and MULTI-SELECT IS IMPOSSIBLE. Keeping the state
// in here keeps `columns` stable across a selection, so the popover survives.
//
// The page still needs the selection (to narrow the query). It reads it by
// subscribing to the SAME url param via `useLinkedSkuFilterParam` below —
// `urlStateManager` notifies every subscriber of a key, so the two stay in step
// without the page ever owning the value.
// ─────────────────────────────────────────────────────────────────────────────

export interface LinkedSKUFilterOption {
    label: string;
    value: string;
}

/**
 * Read/write a comma-joined multi-select stored in one url param, synced through
 * `urlStateManager`.
 *
 * NOT `useStateSyncedWithParams`: that writes through react-router, whose
 * `useSearchParams` snapshot never sees the params the data-table writes with
 * `history.replaceState`. Writing through it would rebuild the query string
 * from that stale snapshot and silently drop the live search / Work Package
 * facet / sort from the URL on every click of this filter.
 *
 * Safe to call from several components at once — a write notifies every
 * subscriber of the key, which is exactly how the filter control and the page
 * share this value without either owning it.
 */
export function useLinkedSkuFilterParam(paramKey: string) {
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

interface LinkedSKUFilterProps {
    options: LinkedSKUFilterOption[];
    /** The `urlStateManager` param key this control owns. */
    paramKey: string;
}

export function LinkedSKUFilter({ options, paramKey }: LinkedSKUFilterProps) {
    const { values, setValues } = useLinkedSkuFilterParam(paramKey);
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
                    title="Filter by linked Item SKUs"
                >
                    {selected.size > 0 ? (
                        <FilterX className="text-primary h-4 w-4 animate-bounce" />
                    ) : (
                        <Filter className="text-primary h-4 w-4" />
                    )}
                </div>
            </PopoverTrigger>
            {/* No CommandInput: two fixed options need no search box. */}
            <PopoverContent className="w-[200px] p-0" align="start">
                <Command>
                    <CommandList>
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
                                                "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                                                isSelected
                                                    ? "bg-primary text-primary-foreground"
                                                    : "opacity-50 [&_svg]:invisible"
                                            )}
                                        >
                                            <CheckIcon className="h-4 w-4" />
                                        </div>
                                        <span>{option.label}</span>
                                    </CommandItem>
                                );
                            })}
                        </CommandGroup>
                        {selected.size > 0 && (
                            <>
                                <CommandSeparator />
                                <CommandGroup>
                                    <CommandItem
                                        onSelect={() => setValues([])}
                                        className="justify-center text-center"
                                    >
                                        Clear filters
                                    </CommandItem>
                                </CommandGroup>
                            </>
                        )}
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
