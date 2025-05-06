// import {
//     Command,
//     CommandEmpty,
//     CommandGroup,
//     CommandInput,
//     CommandItem,
//     CommandList,
//     CommandSeparator,
// } from "@/components/ui/command";
// import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
// import { cn } from "@/lib/utils";
// import { urlStateManager } from "@/utils/urlStateManager";
// import { CheckIcon } from "@radix-ui/react-icons";
// import { Column } from "@tanstack/react-table";
// import { Filter, FilterX } from "lucide-react";
// import * as React from "react";

// interface DataTableFacetedFilterProps<TData, TValue> {
//     column?: Column<TData, TValue>;
//     title: string;
//     options: {
//         label: string;
//         value: string;
//         icon?: React.ComponentType<{ className?: string }>;
//     }[];
// }

// export function DataTableFacetedFilter<TData, TValue>({
//     column,
//     title,
//     options,
// }: DataTableFacetedFilterProps<TData, TValue>) {
//     // const facets = column?.getFacetedUniqueValues();
//     // const currentRoute = window.location.pathname;

//     // // Retrieve filter values from the store
//     // const filters = useFilterStore((state) => state.getFilters(currentRoute, title));
//     // const [selectedValues, setSelectedValues] = React.useState(new Set(filters || []));

//     // React.useEffect(() => {
//     //     if ((filters || []).length) {
//     //         setSelectedValues(new Set(filters));
//     //         column?.setFilterValue(filters);
//     //     }
//     // }, [filters, column]);

//     // const handleSelect = (option) => {
//     //     const newSelectedValues = new Set(selectedValues);

//     //     if (newSelectedValues.has(option.value)) {
//     //         newSelectedValues.delete(option.value);
//     //     } else {
//     //         newSelectedValues.add(option.value);
//     //     }
//     //     setSelectedValues(newSelectedValues);

//     //     const filterValues = Array.from(newSelectedValues);
//     //     column?.setFilterValue(filterValues.length ? filterValues : undefined);

//     //     useFilterStore.getState().setFilters(currentRoute, title, filterValues);
//     // };

//     // const clearFilters = () => {
//     //     setSelectedValues(new Set());
//     //     column?.setFilterValue(undefined);
//     //     useFilterStore.getState().clearFilters(currentRoute, title); // Clear in store
//     // };

//     const [selectedValues, setSelectedValues] = React.useState<Set<string>>(new Set());
//     // const popoverTriggerRef = React.useRef<HTMLDivElement>(null);
//     // const [searchParams, setSearchParams] = useSearchParams();

//     // Initialize selected values from URL parameters
//     // React.useEffect(() => {
//     //     const filterParam = searchParams.get(title);
//     //     if (filterParam) {
//     //         const values = new Set(filterParam.split(","));
//     //         setSelectedValues(values);
//     //         column?.setFilterValue(Array.from(values));
//     //     } else {
//     //         setSelectedValues(new Set());
//     //         column?.setFilterValue(undefined);
//     //     }
//     // }, [searchParams, title, column]);

//     // const handleSelect = (option: { value: string }) => {
//     //     const newSelectedValues = new Set(selectedValues);

//     //     if (newSelectedValues.has(option.value)) {
//     //         newSelectedValues.delete(option.value);
//     //     } else {
//     //         newSelectedValues.add(option.value);
//     //     }

//     //     setSelectedValues(newSelectedValues);

//     //     const filterValues = Array.from(newSelectedValues);
//     //     column?.setFilterValue(filterValues.length ? filterValues : undefined);

//     //     // Update URL parameters
//     //     const newSearchParams = new URLSearchParams(searchParams);
//     //     if (filterValues.length) {
//     //         newSearchParams.set(title, filterValues.join(","));
//     //     } else {
//     //         newSearchParams.delete(title);
//     //     }
//     //     setSearchParams(newSearchParams);
//     // };

//     // const clearFilters = () => {
//     //     setSelectedValues(new Set());
//     //     column?.setFilterValue(undefined);

//     //     // Remove filter from URL parameters
//     //     const newSearchParams = new URLSearchParams(searchParams);
//     //     newSearchParams.delete(title);
//     //     setSearchParams(newSearchParams);
//     // };

//     // React.useEffect(() => {
//     //     const urlParams = new URLSearchParams(window.location.search);
//     //     const filterParam = urlParams.get(title);
//     //     if (filterParam) {
//     //         const values = new Set(filterParam.split(","));
//     //         setSelectedValues(values);
//     //         column?.setFilterValue(Array.from(values));
//     //     } else {
//     //         setSelectedValues(new Set());
//     //         column?.setFilterValue(undefined);
//     //     }
//     // }, [title, column]);

//     React.useEffect(() => {
//         const unsubscribe = urlStateManager.subscribe(title, (_, value) => {
//           const values = new Set(value?.split(',') || []);
//           setSelectedValues(values);
//           column?.setFilterValue(values.size ? Array.from(values) : undefined);
//         });
    
//         return () => unsubscribe();
//       }, [title, column]);
    

//     // const updateURL = React.useCallback((key: string, value: string[] | undefined) => {
//     //     const url = new URL(window.location.href);
//     //     if (value && value.length) {
//     //         url.searchParams.set(key, value.join(","));
//     //     } else {
//     //         url.searchParams.delete(key);
//     //     }
//     //     window.history.pushState({}, "", url);
//     // }, []);

//     const handleSelect = React.useCallback((option: { value: string }) => {
//         const newSelectedValues = new Set(selectedValues);

//         if (newSelectedValues.has(option.value)) {
//             newSelectedValues.delete(option.value);
//         } else {
//             newSelectedValues.add(option.value);
//         }

//         const filterValues = Array.from(newSelectedValues);
//         setSelectedValues(newSelectedValues);
//         column?.setFilterValue(filterValues.length ? filterValues : undefined);
        
//         urlStateManager.updateParam(title, filterValues.length ? filterValues.join(",") : null);
//         // Update URL parameters
//         // updateURL(title, filterValues.length ? filterValues : undefined);
//         // popoverTriggerRef.current?.focus();
//     }, [ column, title, selectedValues]);

//     const clearFilters = React.useCallback(() => {
//         setSelectedValues(new Set());
//         column?.setFilterValue(undefined);
//         urlStateManager.updateParam(title, null);
//         // popoverTriggerRef.current?.focus();
//         // Clear filter from URL parameters
//         // updateURL(title, undefined);
//     }, [ column, title, selectedValues]);


//     return (
//         <Popover>
//             <PopoverTrigger asChild>
//                 <div 
//                 // ref={popoverTriggerRef} 
//                 className={`cursor-pointer ${selectedValues.size > 0 && "bg-gray-200"} hover:bg-gray-100 px-1 pt-2 pb-1 rounded-md`}>
//                     {selectedValues.size > 0 ? (
//                         <FilterX className={`text-primary h-4 w-4 ${selectedValues.size > 0 && "animate-bounce"}`} />
//                     ) : (
//                         <Filter className="text-primary h-4 w-4" />
//                     )}
//                     {/* Filter by {title} */}
//                     {/* {selectedValues?.size > 0 && (
//                         <>
//                             <Separator orientation="vertical" className="mx-2 h-4" />
//                             <Badge variant="secondary" className="rounded-sm px-1 font-normal lg:hidden">
//                                 {selectedValues.size}
//                             </Badge>
//                             <div className="hidden space-x-1 lg:flex">
//                                 {selectedValues.size > 2 ? (
//                                     <Badge variant="secondary" className="rounded-sm px-1 font-normal">
//                                         <HoverCard>
//                                             <HoverCardTrigger>
//                                                 {selectedValues.size} {"Selected"}
//                                             </HoverCardTrigger>
//                                             <HoverCardContent>
//                                                 <div className="flex flex-col items-start gap-2">
//                                                 {
//                                                     options
//                                                     .filter((option) => selectedValues.has(option.value))
//                                                     .map((option) => (
//                                                         <Badge
//                                                             variant="destructive"
//                                                             key={option.value}
//                                                             className="rounded-sm px-1 font-normal">
//                                                             {option.label}
//                                                         </Badge>
//                                                     ))
//                                                 }
//                                                 </div>
//                                             </HoverCardContent>
//                                         </HoverCard>
//                                     </Badge>
//                                 ) : (
//                                     options
//                                         .filter((option) => selectedValues.has(option.value))
//                                         .map((option) => (
//                                             <Badge
//                                                 variant="secondary"
//                                                 key={option.value}
//                                                 className="rounded-sm px-1 font-normal">
//                                                 {option.label}
//                                             </Badge>
//                                         ))
//                                 )}
//                             </div>
//                         </>
//                     )} */}
//                 </div>
//             </PopoverTrigger>
//             <PopoverContent className="w-[200px] p-0" align="start">
//                 <Command>
//                     <CommandInput placeholder={`Search ${title}..`} />
//                     <div className="relative">
//                         <CommandList className={`overflow-y-auto ${selectedValues.size > 0 && "mb-10"}`}> {/* Adjust max height as needed */}
//                             <CommandEmpty>{"No Filter results"}</CommandEmpty>
//                             <CommandGroup>
//                                 {options.map((option) => {
//                                     const isSelected = selectedValues.has(option.value);
//                                     return (
//                                         <CommandItem
//                                             key={option.value}
//                                             onSelect={() => handleSelect(option)}>
//                                             <div
//                                                 className={cn(
//                                                     "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
//                                                     isSelected
//                                                         ? "bg-primary text-primary-foreground"
//                                                         : "opacity-50 [&_svg]:invisible"
//                                                 )}>
//                                                 <CheckIcon className={cn("h-4 w-4")} />
//                                             </div>
//                                             {option.icon && <option.icon className="mr-2 h-4 w-4 text-muted-foreground" />}
//                                             <span>{option.label}</span>
//                                             {/* {facets?.get(option.value) && (
//                                                 <span className="ml-auto flex h-4 w-4 items-center justify-center font-mono text-xs">
//                                                     {facets.get(option.value)}
//                                                 </span>
//                                             )} */}
//                                         </CommandItem>
//                                     );
//                                 })}
//                             </CommandGroup>
//                         </CommandList>
//                         {selectedValues.size > 0 && (
//                             <div className="absolute bottom-0 w-full bg-white">
//                                 <CommandSeparator />
//                                 <CommandGroup>
//                                     <CommandItem
//                                         onSelect={clearFilters}
//                                         className="justify-center text-center text-primary font-semibold">
//                                         {"Clean Filters"}
//                                     </CommandItem>
//                                 </CommandGroup>
//                             </div>
//                         )}
//                     </div>
//                 </Command>
//             </PopoverContent>
//         </Popover>
//     );
// }

// // import React, { useEffect, useState } from "react";
// // import { CheckIcon } from "@radix-ui/react-icons";
// // import { Column } from "@tanstack/react-table";
// // import { cn } from "@/lib/utils";
// // import {
// //     Command,
// //     CommandEmpty,
// //     CommandGroup,
// //     CommandInput,
// //     CommandItem,
// //     CommandList,
// //     CommandSeparator,
// // } from "@/components/ui/command";
// // import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
// // import { useSearchParams, useLocation, useNavigate } from "react-router-dom";

// // interface DataTableFacetedFilterProps<TData, TValue> {
// //     column?: Column<TData, TValue>;
// //     title: string;
// //     options: {
// //         label: string;
// //         value: string;
// //         icon?: React.ComponentType<{ className?: string }>;
// //     }[];
// // }

// // export function DataTableFacetedFilter<TData, TValue>({
// //     column,
// //     title,
// //     options,
// // }: DataTableFacetedFilterProps<TData, TValue>) {
// //     const [selectedValues, setSelectedValues] = useState<Set<string>>(new Set());
// //     const [searchParams, setSearchParams] = useSearchParams();

// //     // Initialize selected values from URL parameters
// //     useEffect(() => {
// //         const filterParam = searchParams.get(title);
// //         if (filterParam) {
// //             const values = new Set(filterParam.split(","));
// //             setSelectedValues(values);
// //             column?.setFilterValue(Array.from(values));
// //         } else {
// //             setSelectedValues(new Set());
// //             column?.setFilterValue(undefined);
// //         }
// //     }, [searchParams, title, column]);

// //     const handleSelect = (option: { value: string }) => {
// //         const newSelectedValues = new Set(selectedValues);

// //         if (newSelectedValues.has(option.value)) {
// //             newSelectedValues.delete(option.value);
// //         } else {
// //             newSelectedValues.add(option.value);
// //         }

// //         setSelectedValues(newSelectedValues);

// //         const filterValues = Array.from(newSelectedValues);
// //         column?.setFilterValue(filterValues.length ? filterValues : undefined);

// //         // Update URL parameters
// //         const newSearchParams = new URLSearchParams(searchParams);
// //         if (filterValues.length) {
// //             newSearchParams.set(title, filterValues.join(","));
// //         } else {
// //             newSearchParams.delete(title);
// //         }
// //         setSearchParams(newSearchParams);
// //     };

// //     const clearFilters = () => {
// //         setSelectedValues(new Set());
// //         column?.setFilterValue(undefined);

// //         // Remove filter from URL parameters
// //         const newSearchParams = new URLSearchParams(searchParams);
// //         newSearchParams.delete(title);
// //         setSearchParams(newSearchParams);
// //     };

// //     return (
// //         <Popover>
// //             <PopoverTrigger asChild>
// //                 <div
// //                     className={`cursor-pointer ${
// //                         selectedValues.size > 0 && "bg-gray-200"
// //                     } hover:bg-gray-100 px-1 pt-2 pb-1 rounded-md`}
// //                 >
// //                     {selectedValues.size > 0 ? (
// //                         <FilterX
// //                             className={`text-primary h-4 w-4 ${
// //                                 selectedValues.size > 0 && "animate-bounce"
// //                             }`}
// //                         />
// //                     ) : (
// //                         <Filter className="text-primary h-4 w-4" />
// //                     )}
// //                 </div>
// //             </PopoverTrigger>
// //             <PopoverContent className="w-[200px] p-0" align="start">
// //                 <Command>
// //                     <CommandInput placeholder={`Search ${title}...`} />
// //                     <div className="relative">
// //                         <CommandList className={`overflow-y-auto ${selectedValues.size > 0 && "mb-10"}`}>
// //                             <CommandEmpty>No filter results</CommandEmpty>
// //                             <CommandGroup>
// //                                 {options.map((option) => {
// //                                     const isSelected = selectedValues.has(option.value);
// //                                     return (
// //                                         <CommandItem
// //                                             key={option.value}
// //                                             onSelect={() => handleSelect(option)}
// //                                         >
// //                                             <div
// //                                                 className={cn(
// //                                                     "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
// //                                                     isSelected
// //                                                         ? "bg-primary text-primary-foreground"
// //                                                         : "opacity-50 [&_svg]:invisible"
// //                                                 )}
// //                                             >
// //                                                 <CheckIcon className={cn("h-4 w-4")} />
// //                                             </div>
// //                                             {option.icon && (
// //                                                 <option.icon className="mr-2 h-4 w-4 text-muted-foreground" />
// //                                             )}
// //                                             <span>{option.label}</span>
// //                                         </CommandItem>
// //                                     );
// //                                 })}
// //                             </CommandGroup>
// //                         </CommandList>
// //                         {selectedValues.size > 0 && (
// //                             <div className="absolute bottom-0 w-full bg-white">
// //                                 <CommandSeparator />
// //                                 <CommandGroup>
// //                                     <CommandItem
// //                                         onSelect={clearFilters}
// //                                         className="justify-center text-center text-primary font-semibold"
// //                                     >
// //                                         Clean Filters
// //                                     </CommandItem>
// //                                 </CommandGroup>
// //                             </div>
// //                         )}
// //                     </div>
// //                 </Command>
// //             </PopoverContent>
// //         </Popover>
// //     );
// // }


// src/components/data-table/data-table-faceted-filter.tsx
import * as React from 'react';
import { CheckIcon, PlusCircledIcon } from '@radix-ui/react-icons';
import { Column } from '@tanstack/react-table';

import { cn } from '@/lib/utils'; // Adjust path
import { Badge } from '@/components/ui/badge'; // Adjust path
import { Button } from '@/components/ui/button'; // Adjust path
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
import { Separator } from '@/components/ui/separator'; // Adjust path
import { urlStateManager } from '@/utils/urlStateManager';

interface DataTableFacetedFilterProps<TData, TValue> {
    column?: Column<TData, TValue>; // Keep column for potential future use or getting ID
    title?: string;
    options: {
        label: string;
        value: string;
        icon?: React.ComponentType<{ className?: string }>;
    }[];
    /** The key used for this filter in the URL state (e.g., column id 'category') */
    urlSyncKey: string;
    /** Optional base key if using nested URL state (e.g., 'items') */
    urlBaseKey?: string;
}

export function DataTableFacetedFilter<TData, TValue>({
    column, // May not be strictly needed now, but good for context
    title,
    options,
    urlSyncKey,
    urlBaseKey,
}: DataTableFacetedFilterProps<TData, TValue>) {
    // Construct the full URL parameter key
    const urlParamKey = urlBaseKey ? `${urlBaseKey}_${urlSyncKey}` : urlSyncKey;

    // Get selected values directly from URL state
    const [selectedValues, setSelectedValues] = React.useState<Set<string>>(() => {
        const urlValue = urlStateManager.getParam(urlParamKey);
        return new Set(urlValue ? urlValue.split(',') : []);
    });

    // Subscribe to URL changes to keep local state synchronized
    React.useEffect(() => {
        const unsubscribe = urlStateManager.subscribe(urlParamKey, (_, value) => {
             setSelectedValues(new Set(value ? value.split(',') : []));
        });
        // Initial sync on mount in case URL loaded before component
         const initialUrlValue = urlStateManager.getParam(urlParamKey);
         setSelectedValues(new Set(initialUrlValue ? initialUrlValue.split(',') : []));

        return () => unsubscribe();
    }, [urlParamKey]);


    // Update URL when selection changes
    const updateUrlState = (newSelectedValues: Set<string>) => {
        const sortedValues = Array.from(newSelectedValues).sort();
        urlStateManager.updateParam(urlParamKey, sortedValues.length > 0 ? sortedValues.join(',') : null);
        // State will auto-update via the subscription effect
    };

    const handleSelect = (value: string) => {
         const newSelectedValues = new Set(selectedValues);
         if (newSelectedValues.has(value)) {
             newSelectedValues.delete(value);
         } else {
             newSelectedValues.add(value);
         }
         updateUrlState(newSelectedValues);
     };

    const handleClear = () => {
         updateUrlState(new Set());
     };

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 border-dashed">
                    <PlusCircledIcon className="mr-2 h-4 w-4" />
                    {title}
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
            </PopoverTrigger>
            <PopoverContent className="w-[200px] p-0" align="start">
                <Command>
                    <CommandInput placeholder={title} />
                    <CommandList>
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
                        {selectedValues.size > 0 && (
                            <>
                                <CommandSeparator />
                                <CommandGroup>
                                    <CommandItem
                                        onSelect={handleClear}
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
