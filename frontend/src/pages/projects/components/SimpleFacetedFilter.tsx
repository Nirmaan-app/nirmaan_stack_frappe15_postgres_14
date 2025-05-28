import React from 'react';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
// import { Button } from "@/components/ui/button";
// import { Badge } from "@/components/ui/badge";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { CheckIcon, PlusCircledIcon } from "@radix-ui/react-icons";
import { cn } from "@/lib/utils";
import { Filter, FilterX } from 'lucide-react';

interface SimpleFacetedFilterProps {
    title: string;
    options: { label: string; value: string }[];
    selectedValues: Set<string>;
    onSelectedValuesChange: (newSelectedValues: Set<string>) => void;
}

export const SimpleFacetedFilter: React.FC<SimpleFacetedFilterProps> = ({
    title,
    options,
    selectedValues,
    onSelectedValuesChange,
}) => {
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
            <PopoverContent className="w-[200px] p-0" align="start">
                <Command>
                    <CommandInput placeholder={title} />
                    <div className="relative">
                    <CommandList className={`overflow-y-auto ${selectedValues.size > 0 && "mb-10"}`}>
                        <CommandEmpty>No results found.</CommandEmpty>
                        <CommandGroup>
                            {options.map((option) => {
                                const isSelected = selectedValues.has(option.value);
                                return (
                                    <CommandItem
                                        key={option.value}
                                        onSelect={() => {
                                            const newSelected = new Set(selectedValues);
                                            if (isSelected) {
                                                newSelected.delete(option.value);
                                            } else {
                                                newSelected.add(option.value);
                                            }
                                            onSelectedValuesChange(newSelected);
                                        }}
                                    >
                                        <div className={cn("mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary", isSelected ? "bg-primary text-primary-foreground" : "opacity-50 [&_svg]:invisible")}>
                                            <CheckIcon className={cn("h-4 w-4")} />
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
                                        onSelect={() => onSelectedValuesChange(new Set())}
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