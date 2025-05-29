import * as React from 'react';
import { CheckIcon, PlusCircledIcon } from '@radix-ui/react-icons';
import { Column } from '@tanstack/react-table';

import { cn } from '@/lib/utils'; // Adjust path
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator,
} from '@/components/ui/command'; // Adjust path
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover'; // Adjust path
import { Filter, FilterX } from 'lucide-react';
// import { urlStateManager } from '@/utils/urlStateManager';

interface DataTableFacetedFilterProps<TData, TValue> {
    column?: Column<TData, TValue>; // Keep column for potential future use or getting ID
    title?: string;
    options: {
        label: string;
        value: string;
        icon?: React.ComponentType<{ className?: string }>;
    }[];
    /** The key used for this filter in the URL state (e.g., column id 'category') */
    // urlSyncKey: string;
    /** Optional base key if using nested URL state (e.g., 'items') */
    // urlBaseKey?: string;
}

export function DataTableFacetedFilter<TData, TValue>({
    column, // May not be strictly needed now, but good for context
    title,
    options,
    // urlSyncKey,
    // urlBaseKey,
}: DataTableFacetedFilterProps<TData, TValue>) {


    if (!column) {
        console.warn("DataTableFacetedFilter: 'column' prop is missing. Faceted filter will not work.");
        return null;
    }

    // Get selected values from TanStack Table's column filter state
    const selectedValues = React.useMemo(() => {
        const filterValue = column.getFilterValue();
        // Ensure it's an array, as that's what we set and expect for multi-select
        return new Set<string>(Array.isArray(filterValue) ? filterValue : []);
    }, [column.getFilterValue()]);


    const handleSelect = (value: string) => {
        const currentFilterValue = column.getFilterValue();
        const currentSelectedSet = new Set<string>(Array.isArray(currentFilterValue) ? currentFilterValue : []);

        if (currentSelectedSet.has(value)) {
            currentSelectedSet.delete(value);
        } else {
            currentSelectedSet.add(value);
        }
        // Update TanStack Table's filter state
        // If set is empty, pass undefined to clear the filter for this column
        column.setFilterValue(currentSelectedSet.size > 0 ? Array.from(currentSelectedSet) : undefined);
    };

    const handleClear = () => {
        column.setFilterValue(undefined); // Clear filter for this column
    };
    // // Construct the full URL parameter key
    // const urlParamKey = urlBaseKey ? `${urlBaseKey}_${urlSyncKey}` : urlSyncKey;

    // // Get selected values directly from URL state
    // const [selectedValues, setSelectedValues] = React.useState<Set<string>>(() => {
    //     const urlValue = urlStateManager.getParam(urlParamKey);
    //     return new Set(urlValue ? urlValue.split(',') : []);
    // });

    // // Subscribe to URL changes to keep local state synchronized
    // React.useEffect(() => {
    //     const unsubscribe = urlStateManager.subscribe(urlParamKey, (_, value) => {
    //          setSelectedValues(new Set(value ? value.split(',') : []));
    //     });
    //     // Initial sync on mount in case URL loaded before component
    //      const initialUrlValue = urlStateManager.getParam(urlParamKey);
    //      setSelectedValues(new Set(initialUrlValue ? initialUrlValue.split(',') : []));

    //     return () => unsubscribe();
    // }, [urlParamKey]);


    // // Update URL when selection changes
    // const updateUrlState = (newSelectedValues: Set<string>) => {
    //     const sortedValues = Array.from(newSelectedValues).sort();
    //     urlStateManager.updateParam(urlParamKey, sortedValues.length > 0 ? sortedValues.join(',') : null);
    //     // State will auto-update via the subscription effect
    // };

    // const handleSelect = (value: string) => {
    //      const newSelectedValues = new Set(selectedValues);
    //      if (newSelectedValues.has(value)) {
    //          newSelectedValues.delete(value);
    //      } else {
    //          newSelectedValues.add(value);
    //      }
    //      updateUrlState(newSelectedValues);
    //  };

    // const handleClear = () => {
    //      updateUrlState(new Set());
    //  };

    return (
        <Popover>
             <PopoverTrigger asChild>
                 <div
                     className={`cursor-pointer ${
                         selectedValues.size > 0 && "bg-gray-200"
                     } hover:bg-gray-100 px-1 py-1 rounded-md`}
                 >
                     {selectedValues.size > 0 ? (
                         <FilterX
                             className={`text-primary h-4 w-4 ${
                                 selectedValues.size > 0 && "animate-bounce"
                             }`}
                         />
                     ) : (
                         <Filter className="text-primary h-4 w-4" />
                     )}
                 </div>
             </PopoverTrigger>
            {/* <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 border-dashed">
                    <PlusCircledIcon className="mr-2 h-4 w-4" />
                    {title || column.id}
                    {selectedValues.size > 0 && (
                        <>
                            <Separator orientation="vertical" className="mx-2 h-4" />
                            <Badge
                                variant="secondary"
                                className="rounded-sm px-1 font-normal lg:hidden"
                            >
                                {selectedValues.size}
                            </Badge>
                            <div className="hidden space-x-1 lg:flex">
                                {selectedValues.size > 2 ? (
                                    <Badge
                                        variant="secondary"
                                        className="rounded-sm px-1 font-normal"
                                    >
                                        {selectedValues.size} selected
                                    </Badge>
                                ) : (
                                    options
                                        .filter((option) => selectedValues.has(option.value))
                                        .map((option) => (
                                            <Badge
                                                variant="secondary"
                                                key={option.value}
                                                className="rounded-sm px-1 font-normal"
                                            >
                                                {option.label}
                                            </Badge>
                                        ))
                                )}
                            </div>
                        </>
                    )}
                </Button>
            </PopoverTrigger> */}
            <PopoverContent className="w-[200px] p-0" align="start">
                <Command>
                    <CommandInput placeholder={title || column.id} />
                    <div className="relative">
                    <CommandList className={`overflow-y-auto ${selectedValues.size > 0 && "mb-10"}`}>
                        <CommandEmpty>No results found.</CommandEmpty>
                        <CommandGroup>
                            {options.map((option) => {
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
                                            <CheckIcon className={cn('h-4 w-4')} />
                                        </div>
                                        {option.icon && (
                                            <option.icon className="mr-2 h-4 w-4 text-muted-foreground" />
                                        )}
                                        <span>{option.label}</span>
                                        {/* Optional: Display facets count if available from column
                                        {facets?.get(option.value) && (
                                          <span className="ml-auto flex h-4 w-4 items-center justify-center font-mono text-xs">
                                            {facets.get(option.value)}
                                          </span>
                                        )} */}
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
}
