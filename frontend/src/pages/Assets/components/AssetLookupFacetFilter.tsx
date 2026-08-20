import React from 'react';
import { Check, Filter, FilterX } from 'lucide-react';

import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator,
} from '@/components/ui/command';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface AssetLookupFacetFilterProps {
    title: string;
    options: { label: string; value: string }[];
    /**
     * Notified after every toggle. MUST be reference-stable (a `useState` setter
     * is; an inline arrow is not) — see the state-ownership note below.
     */
    onChange: (next: string[]) => void;
    isLoading?: boolean;
}

/**
 * Faceted filter for a column whose value comes from the LINKED Asset Master
 * rather than from the listed doctype (Asset Management).
 *
 * Why this exists instead of DataTable's built-in `facetFilterOptions`: that path
 * writes the selection into TanStack's column-filter state, which
 * `convertTanstackFiltersToFrappe` turns into a filter on the LISTED doctype — so
 * it would send `["project", "in", ...]` against Asset Management, which has no
 * such field. Frappe's dot-notation cross-doctype filter is not an escape either:
 * it joins on `parenttype`/`parent`, so it only covers child tables, not a Link
 * (verified: "column tabAsset Master.parenttype does not exist").
 *
 * So the selection is held by the page instead, which resolves it into the
 * `["asset", "in", [...]]` scope the tab already uses. The rows are still filtered
 * by the SERVER — only the project→asset-id translation happens locally — and no
 * shared table hook or backend filter code is touched.
 *
 * Rendered inside the column's own `header` render prop (DataTable calls it via
 * flexRender), so it sits where the built-in funnels sit.
 *
 * PRESENTATION IS A DELIBERATE MIRROR of `DataTableFacetedFilter` — same trigger
 * box, same `text-primary h-4 w-4` icons, same active `bg-gray-200` + bounce, same
 * 200px popover and item markup — so a user cannot tell the two apart. Only the
 * state plumbing differs. Keep them in sync if that component's styling changes.
 *
 * SELECTION IS OWNED HERE, NOT BY THE PAGE — that is load-bearing, not a style
 * choice. This filter is rendered from a column's `header` render prop, so the
 * page's `columns` memo would have to list the selection in its deps to avoid a
 * stale closure. Every checkbox would then rebuild the column definitions,
 * remounting this Popover and slamming it shut after ONE pick — no multi-select.
 * The built-in filter dodges this because its selection lives in TanStack's own
 * column-filter state rather than in the page. Holding it internally and pushing
 * changes out through a stable `onChange` keeps the column defs identical across
 * toggles, so the popover stays open.
 */
export const AssetLookupFacetFilter: React.FC<AssetLookupFacetFilterProps> = ({
    title,
    options,
    onChange,
    isLoading = false,
}) => {
    const [selectedValues, setSelectedValues] = React.useState<Set<string>>(new Set());

    const handleSelect = (value: string) => {
        const next = new Set(selectedValues);
        if (next.has(value)) next.delete(value);
        else next.add(value);
        setSelectedValues(next);
        onChange(Array.from(next));
    };

    const handleClear = () => {
        setSelectedValues(new Set());
        onChange([]);
    };

    return (
        <Popover>
            <PopoverTrigger asChild>
                <div
                    className={`cursor-pointer ${selectedValues.size > 0 && "bg-gray-200"
                        } hover:bg-gray-100 px-1 py-1 rounded-md`}
                >
                    {selectedValues.size > 0 ? (
                        <FilterX
                            className={`text-primary h-4 w-4 ${selectedValues.size > 0 && "animate-bounce"
                                }`}
                        />
                    ) : (
                        <Filter className="text-primary h-4 w-4" />
                    )}
                </div>
            </PopoverTrigger>
            <PopoverContent className="w-[200px] p-0" align="start">
                <Command>
                    <CommandInput placeholder={title} />
                    <div className="relative">
                        <CommandList className={`overflow-y-auto ${selectedValues.size > 0 && "mb-10"}`}>
                            <CommandEmpty>
                                {isLoading ? "Loading options..." : (!options || options.length === 0 ? "No options available" : "No results found.")}
                            </CommandEmpty>
                            <CommandGroup>
                                {options?.map((option) => {
                                    const isSelected = selectedValues.has(option.value);
                                    return (
                                        <CommandItem
                                            key={option.value}
                                            onSelect={() => handleSelect(option.value)}
                                        >
                                            <div
                                                className={cn(
                                                    'mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary',
                                                    isSelected
                                                        ? 'bg-primary text-primary-foreground'
                                                        : 'opacity-50 [&_svg]:invisible'
                                                )}
                                            >
                                                <Check className={cn('h-4 w-4')} />
                                            </div>
                                            <span>{option.label}</span>
                                        </CommandItem>
                                    );
                                })}
                            </CommandGroup>
                        </CommandList>
                        {selectedValues.size > 0 && (
                            <div className="absolute bottom-0 w-full bg-white">
                                <CommandSeparator />
                                <CommandGroup>
                                    <CommandItem
                                        onSelect={handleClear}
                                        className="justify-center text-center"
                                    >
                                        Clear filters
                                    </CommandItem>
                                </CommandGroup>
                            </div>
                        )}
                    </div>
                </Command>
            </PopoverContent>
        </Popover>
    );
};
