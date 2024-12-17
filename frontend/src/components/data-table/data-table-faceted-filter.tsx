import * as React from "react";
import { CheckIcon } from "@radix-ui/react-icons";
import { Column } from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "../ui/hover-card";
import { Filter, FilterX } from "lucide-react";
import { useFilterStore } from "@/zustand/useFilterStore";
import { useSearchParams } from "react-router-dom";

interface DataTableFacetedFilterProps<TData, TValue> {
    column?: Column<TData, TValue>;
    title: string;
    options: {
        label: string;
        value: string;
        icon?: React.ComponentType<{ className?: string }>;
    }[];
}

export function DataTableFacetedFilter<TData, TValue>({
    column,
    title,
    options,
}: DataTableFacetedFilterProps<TData, TValue>) {
    // const facets = column?.getFacetedUniqueValues();
    // const currentRoute = window.location.pathname;

    // // Retrieve filter values from the store
    // const filters = useFilterStore((state) => state.getFilters(currentRoute, title));
    // const [selectedValues, setSelectedValues] = React.useState(new Set(filters || []));

    // React.useEffect(() => {
    //     if ((filters || []).length) {
    //         setSelectedValues(new Set(filters));
    //         column?.setFilterValue(filters);
    //     }
    // }, [filters, column]);

    // const handleSelect = (option) => {
    //     const newSelectedValues = new Set(selectedValues);
    
    //     if (newSelectedValues.has(option.value)) {
    //         newSelectedValues.delete(option.value);
    //     } else {
    //         newSelectedValues.add(option.value);
    //     }
    //     setSelectedValues(newSelectedValues);
    
    //     const filterValues = Array.from(newSelectedValues);
    //     column?.setFilterValue(filterValues.length ? filterValues : undefined);
    
    //     useFilterStore.getState().setFilters(currentRoute, title, filterValues);
    // };

    // const clearFilters = () => {
    //     setSelectedValues(new Set());
    //     column?.setFilterValue(undefined);
    //     useFilterStore.getState().clearFilters(currentRoute, title); // Clear in store
    // };

    const [selectedValues, setSelectedValues] = React.useState<Set<string>>(new Set());
    const [searchParams, setSearchParams] = useSearchParams();

    // Initialize selected values from URL parameters
    React.useEffect(() => {
        const filterParam = searchParams.get(title);
        if (filterParam) {
            const values = new Set(filterParam.split(","));
            setSelectedValues(values);
            column?.setFilterValue(Array.from(values));
        } else {
            setSelectedValues(new Set());
            column?.setFilterValue(undefined);
        }
    }, [searchParams, title, column]);

    const handleSelect = (option: { value: string }) => {
        const newSelectedValues = new Set(selectedValues);

        if (newSelectedValues.has(option.value)) {
            newSelectedValues.delete(option.value);
        } else {
            newSelectedValues.add(option.value);
        }

        setSelectedValues(newSelectedValues);

        const filterValues = Array.from(newSelectedValues);
        column?.setFilterValue(filterValues.length ? filterValues : undefined);

        // Update URL parameters
        const newSearchParams = new URLSearchParams(searchParams);
        if (filterValues.length) {
            newSearchParams.set(title, filterValues.join(","));
        } else {
            newSearchParams.delete(title);
        }
        setSearchParams(newSearchParams);
    };

    const clearFilters = () => {
        setSelectedValues(new Set());
        column?.setFilterValue(undefined);

        // Remove filter from URL parameters
        const newSearchParams = new URLSearchParams(searchParams);
        newSearchParams.delete(title);
        setSearchParams(newSearchParams);
    };


    return (
        <Popover>
            <PopoverTrigger asChild>
                <div className={`cursor-pointer ${selectedValues.size > 0 && "bg-gray-200"} hover:bg-gray-100 px-1 pt-2 pb-1 rounded-md`}>
                    {selectedValues.size > 0 ? (
                        <FilterX className={`text-primary h-4 w-4 ${selectedValues.size > 0 && "animate-bounce"}`} />
                    ) : (
                        <Filter  className="text-primary h-4 w-4" />
                    )}
                    {/* Filter by {title} */}
                    {/* {selectedValues?.size > 0 && (
                        <>
                            <Separator orientation="vertical" className="mx-2 h-4" />
                            <Badge variant="secondary" className="rounded-sm px-1 font-normal lg:hidden">
                                {selectedValues.size}
                            </Badge>
                            <div className="hidden space-x-1 lg:flex">
                                {selectedValues.size > 2 ? (
                                    <Badge variant="secondary" className="rounded-sm px-1 font-normal">
                                        <HoverCard>
                                            <HoverCardTrigger>
                                                {selectedValues.size} {"Selected"}
                                            </HoverCardTrigger>
                                            <HoverCardContent>
                                                <div className="flex flex-col items-start gap-2">
                                                {
                                                    options
                                                    .filter((option) => selectedValues.has(option.value))
                                                    .map((option) => (
                                                        <Badge
                                                            variant="destructive"
                                                            key={option.value}
                                                            className="rounded-sm px-1 font-normal">
                                                            {option.label}
                                                        </Badge>
                                                    ))
                                                }
                                                </div>
                                            </HoverCardContent>
                                        </HoverCard>
                                    </Badge>
                                ) : (
                                    options
                                        .filter((option) => selectedValues.has(option.value))
                                        .map((option) => (
                                            <Badge
                                                variant="secondary"
                                                key={option.value}
                                                className="rounded-sm px-1 font-normal">
                                                {option.label}
                                            </Badge>
                                        ))
                                )}
                            </div>
                        </>
                    )} */}
                </div>
            </PopoverTrigger>
            <PopoverContent className="w-[200px] p-0" align="start">
                <Command>
                    <CommandInput placeholder={`Search ${title}..`} />
                    <div className="relative">
                        <CommandList  className={`overflow-y-auto ${selectedValues.size > 0 && "mb-10"}`}> {/* Adjust max height as needed */}
                            <CommandEmpty>{"No Filter results"}</CommandEmpty>
                            <CommandGroup>
                                {options.map((option) => {
                                    const isSelected = selectedValues.has(option.value);
                                    return (
                                        <CommandItem
                                            key={option.value}
                                            onSelect={() => handleSelect(option)}>
                                            <div
                                                className={cn(
                                                    "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                                                    isSelected
                                                        ? "bg-primary text-primary-foreground"
                                                        : "opacity-50 [&_svg]:invisible"
                                                )}>
                                                <CheckIcon className={cn("h-4 w-4")} />
                                            </div>
                                            {option.icon && <option.icon className="mr-2 h-4 w-4 text-muted-foreground" />}
                                            <span>{option.label}</span>
                                            {/* {facets?.get(option.value) && (
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
                                        onSelect={clearFilters}
                                        className="justify-center text-center text-primary font-semibold">
                                        {"Clean Filters"}
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

// import React, { useEffect, useState } from "react";
// import { CheckIcon } from "@radix-ui/react-icons";
// import { Column } from "@tanstack/react-table";
// import { cn } from "@/lib/utils";
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
// import { useSearchParams, useLocation, useNavigate } from "react-router-dom";

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
//     const [selectedValues, setSelectedValues] = useState<Set<string>>(new Set());
//     const [searchParams, setSearchParams] = useSearchParams();

//     // Initialize selected values from URL parameters
//     useEffect(() => {
//         const filterParam = searchParams.get(title);
//         if (filterParam) {
//             const values = new Set(filterParam.split(","));
//             setSelectedValues(values);
//             column?.setFilterValue(Array.from(values));
//         } else {
//             setSelectedValues(new Set());
//             column?.setFilterValue(undefined);
//         }
//     }, [searchParams, title, column]);

//     const handleSelect = (option: { value: string }) => {
//         const newSelectedValues = new Set(selectedValues);

//         if (newSelectedValues.has(option.value)) {
//             newSelectedValues.delete(option.value);
//         } else {
//             newSelectedValues.add(option.value);
//         }

//         setSelectedValues(newSelectedValues);

//         const filterValues = Array.from(newSelectedValues);
//         column?.setFilterValue(filterValues.length ? filterValues : undefined);

//         // Update URL parameters
//         const newSearchParams = new URLSearchParams(searchParams);
//         if (filterValues.length) {
//             newSearchParams.set(title, filterValues.join(","));
//         } else {
//             newSearchParams.delete(title);
//         }
//         setSearchParams(newSearchParams);
//     };

//     const clearFilters = () => {
//         setSelectedValues(new Set());
//         column?.setFilterValue(undefined);

//         // Remove filter from URL parameters
//         const newSearchParams = new URLSearchParams(searchParams);
//         newSearchParams.delete(title);
//         setSearchParams(newSearchParams);
//     };

//     return (
//         <Popover>
//             <PopoverTrigger asChild>
//                 <div
//                     className={`cursor-pointer ${
//                         selectedValues.size > 0 && "bg-gray-200"
//                     } hover:bg-gray-100 px-1 pt-2 pb-1 rounded-md`}
//                 >
//                     {selectedValues.size > 0 ? (
//                         <FilterX
//                             className={`text-primary h-4 w-4 ${
//                                 selectedValues.size > 0 && "animate-bounce"
//                             }`}
//                         />
//                     ) : (
//                         <Filter className="text-primary h-4 w-4" />
//                     )}
//                 </div>
//             </PopoverTrigger>
//             <PopoverContent className="w-[200px] p-0" align="start">
//                 <Command>
//                     <CommandInput placeholder={`Search ${title}...`} />
//                     <div className="relative">
//                         <CommandList className={`overflow-y-auto ${selectedValues.size > 0 && "mb-10"}`}>
//                             <CommandEmpty>No filter results</CommandEmpty>
//                             <CommandGroup>
//                                 {options.map((option) => {
//                                     const isSelected = selectedValues.has(option.value);
//                                     return (
//                                         <CommandItem
//                                             key={option.value}
//                                             onSelect={() => handleSelect(option)}
//                                         >
//                                             <div
//                                                 className={cn(
//                                                     "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
//                                                     isSelected
//                                                         ? "bg-primary text-primary-foreground"
//                                                         : "opacity-50 [&_svg]:invisible"
//                                                 )}
//                                             >
//                                                 <CheckIcon className={cn("h-4 w-4")} />
//                                             </div>
//                                             {option.icon && (
//                                                 <option.icon className="mr-2 h-4 w-4 text-muted-foreground" />
//                                             )}
//                                             <span>{option.label}</span>
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
//                                         className="justify-center text-center text-primary font-semibold"
//                                     >
//                                         Clean Filters
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
