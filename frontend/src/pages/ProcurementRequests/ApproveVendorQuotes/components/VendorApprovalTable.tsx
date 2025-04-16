// src/features/procurement/progress/components/VendorApprovalTable.tsx

import * as React from 'react';
import { useState, useEffect, useCallback } from 'react';
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table"; // Adjust path
import { CardContent, CardHeader, CardTitle,
} from "@/components/ui/card"; // Adjust path
import {
    Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion"; // Adjust path
import { Checkbox } from "@/components/ui/checkbox"; // Adjust path
import { cn } from "@/lib/utils"; // Adjust path
import { SelectionState, VendorDataSourceItem, VendorItemDetails } from '../types';
import formatToIndianRupee from '@/utils/FormatPrice';
import { parseNumber } from '@/utils/parseNumber';

interface VendorApprovalTableProps {
    dataSource: VendorDataSourceItem[];
    // Pass initial selection if needed, e.g., from saved state
    initialSelection?: SelectionState;
    // Callback function when selection changes
    onSelectionChange: (newSelection: SelectionState) => void;
    // Optional: Control expanded items externally if needed
    // expandedVendorIds?: string[];
    // onExpandedChange?: (expandedIds: string[]) => void;
}

export const VendorApprovalTable: React.FC<VendorApprovalTableProps> = ({
    dataSource = [], // Default to empty array
    initialSelection,
    onSelectionChange,
}) => {
    // State for managing selections: Map<vendorId, Set<itemId>>
    const [selectedItems, setSelectedItems] = useState<SelectionState>(
        () => initialSelection || new Map()
    );

    // State for controlling which accordions are open
    // Using an array of vendorIds for Accordion type="multiple"
    const [openAccordionItems, setOpenAccordionItems] = useState<string[]>([]);

    // Effect to notify parent component about selection changes
    useEffect(() => {
        onSelectionChange(selectedItems);
    }, [selectedItems, onSelectionChange]);

    // --- Selection Handlers ---

    const handleVendorCheckChange = useCallback((
        vendorId: string,
        allItemsForVendor: VendorItemDetails[],
        isChecked: boolean | 'indeterminate' // Checkbox passes boolean here
    ) => {
        setSelectedItems(prev => {
            const newSelection = new Map(prev);
            if (isChecked === true) {
                // Select all items for this vendor
                const allItemIds = new Set(allItemsForVendor.map(item => item.name)); // Assuming item.name is unique ID
                newSelection.set(vendorId, allItemIds);
            } else {
                // Deselect all items (remove vendor entry)
                newSelection.delete(vendorId);
            }
            return newSelection;
        });
    }, [setSelectedItems]); // Include necessary dependencies

    const handleItemCheckChange = useCallback((
        vendorId: string,
        itemId: string, // Assuming item.name is unique ID
        isChecked: boolean | 'indeterminate'
    ) => {
        setSelectedItems(prev => {
            const newSelection = new Map(prev);
            const vendorSet = newSelection.get(vendorId) ?? new Set(); // Get or create set for vendor

            if (isChecked === true) {
                vendorSet.add(itemId);
            } else {
                vendorSet.delete(itemId);
            }

            if (vendorSet.size === 0) {
                // If no items left selected for this vendor, remove the vendor entry
                newSelection.delete(vendorId);
            } else {
                // Otherwise, update the vendor's set
                newSelection.set(vendorId, vendorSet);
            }
            return newSelection;
        });
    }, [setSelectedItems]); // Include necessary dependencies


    // --- Helper to determine Vendor Checkbox State ---
    const getVendorCheckboxState = (
        vendorId: string,
        totalItemsCount: number
    ): { checked: boolean | 'indeterminate', isFullySelected: boolean } => {
        const selectedVendorSet = selectedItems.get(vendorId);
        const selectedCount = selectedVendorSet?.size ?? 0;

        if (selectedCount === 0) {
            return { checked: false, isFullySelected: false };
        } else if (selectedCount === totalItemsCount) {
            return { checked: true, isFullySelected: true };
        } else {
            // Partially selected -> indeterminate
            return { checked: 'indeterminate', isFullySelected: false };
        }
    };

    // --- Render Logic ---
    if (!dataSource || dataSource.length === 0) {
        return <div className="p-4 text-center text-muted-foreground">No vendor data to display.</div>;
    }

    return (
        <div className="space-y-3">
            <Accordion
                type="multiple" // Allow multiple vendors to be expanded
                value={openAccordionItems}
                onValueChange={setOpenAccordionItems} // Update state when items open/close
                className="w-full space-y-2"
            >
                {dataSource.map((vendorItem) => {
                    const { vendorId, vendorName, totalAmount, items, key, potentialSavingLoss } = vendorItem;
                    const vendorState = getVendorCheckboxState(vendorId, items.length);
                    // const isExpanded = openAccordionItems.includes(vendorId); // Check if current item is expanded

                    return (
                        <AccordionItem value={vendorId} key={key} className="border rounded-md overflow-hidden bg-white shadow-sm">
                             {/* Custom Trigger using CardHeader structure */}
                            <AccordionTrigger className={`!py-0 !px-0 hover:!no-underline focus-visible:!ring-1 focus-visible:!ring-ring focus-visible:!ring-offset-1 rounded-t-md ${vendorState.isFullySelected ? "bg-primary/10" : ""}`}>
                                <CardHeader className="flex flex-row items-center justify-between p-3 w-full cursor-pointer hover:bg-muted/50 transition-colors">
                                    {/* Left Side: Checkbox and Vendor Name */}
                                    <div className="flex items-center gap-3">
                                        <Checkbox
                                            id={`vendor-${vendorId}`}
                                            checked={vendorState.checked}
                                            // Use 'intermediate' attribute if Checkbox supports it,
                                            // otherwise rely on visual styling if needed.
                                            // For ShadCN, we might need a ref (see below if needed)
                                            onCheckedChange={(checkedState) => handleVendorCheckChange(vendorId, items, checkedState)}
                                            onClick={(e) => e.stopPropagation()} // Prevent checkbox click from toggling accordion
                                            aria-label={`Select all items for ${vendorName}`}
                                            className="ml-1" // Add margin for spacing
                                        />
                                        <CardTitle className={cn(
                                             "text-base font-medium",
                                              // vendorState.isFullySelected ? "text-primary" : "text-gray-800"
                                              'text-primary'
                                              )}>
                                            {vendorName}
                                         </CardTitle>
                                    </div>

                                    {/* Right Side: Totals and Savings */}
                                    <div className="flex items-center gap-4 text-xs text-right">
                                        {potentialSavingLoss !== undefined && (
                                             <div className='flex gap-2 items-end'>
                                                 <span className='text-gray-500'>Potential Saving/Loss:</span>
                                                 <span className={cn(
                                                     "font-semibold",
                                                     potentialSavingLoss > 0 ? "text-green-600" : potentialSavingLoss < 0 ? "text-red-600" : "text-gray-600"
                                                 )}>
                                                     {formatToIndianRupee(potentialSavingLoss)} {potentialSavingLoss > 0 ? '(S)' : potentialSavingLoss < 0 ? '(L)' : ''}
                                                 </span>
                                            </div>
                                         )}
                                         <div className='flex items-end gap-2'>
                                             <span className='text-gray-500'>Total Value:</span>
                                             <span className="font-semibold text-gray-700">
                                                 {formatToIndianRupee(totalAmount)}
                                             </span>
                                         </div>
                                        {/* Icon is handled by AccordionTrigger */}
                                        {/* Remove manual icon if AccordionTrigger provides one */}
                                        {/* <ChevronDown className={cn("h-4 w-4 transition-transform duration-200", isExpanded ? "rotate-180" : "")} /> */}
                                    </div>
                                </CardHeader>
                            </AccordionTrigger>

                            {/* Content: The Table */}
                            <AccordionContent>
                                <CardContent className="p-0">
                                    <Table>
                                        <TableHeader className="bg-primary/20">
                                            <TableRow>
                                                <TableHead className="w-10 px-2"> {/* Checkbox column */} </TableHead>
                                                <TableHead className="w-[25%] text-primary">Item Name</TableHead>
                                                <TableHead className="w-[8%] text-center">UOM</TableHead>
                                                <TableHead className="w-[8%] text-center">Qty</TableHead>
                                                <TableHead className="w-[10%] text-right">Rate</TableHead>
                                                <TableHead className="w-[12%] text-right">Amount</TableHead>
                                                <TableHead className="w-[12%] text-right">Lowest Quoted</TableHead>
                                                <TableHead className="w-[12%] text-right">Target Amount</TableHead>
                                                <TableHead className="w-[13%] text-right pr-4">Savings/Loss</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {items.map((item) => {
                                                const isItemSelected = selectedItems.get(vendorId)?.has(item.name) ?? false;
                                                // Calculate item saving/loss (adjust calculation if needed)
                                                const itemSavingLoss = ((item.lowestQuotedAmount || item.targetAmount) && item.amount)
                                                                       ? parseNumber(item.lowestQuotedAmount || item.targetAmount) - item.amount
                                                                       : undefined;

                                                return (
                                                    <TableRow key={item.name}>
                                                        <TableCell className="px-4">
                                                            <Checkbox
                                                                id={`item-${vendorId}-${item.name}`}
                                                                checked={isItemSelected}
                                                                onCheckedChange={(checkedState) => handleItemCheckChange(vendorId, item.name, checkedState)}
                                                                aria-label={`Select item ${item.item}`}
                                                            />
                                                        </TableCell>
                                                        <TableCell className="font-medium text-gray-900">{item.item}</TableCell>
                                                        <TableCell className="text-center">{item.unit}</TableCell>
                                                        <TableCell className="text-center">{item.quantity}</TableCell>
                                                        <TableCell className="text-right">{formatToIndianRupee(item.quote)}</TableCell>
                                                        <TableCell className="text-right">{formatToIndianRupee(item.amount)}</TableCell>
                                                        <TableCell className="text-right">{formatToIndianRupee(item.lowestQuotedAmount)}</TableCell>
                                                        <TableCell className="text-right">{formatToIndianRupee(item.targetAmount)}</TableCell>
                                                        <TableCell className={cn(
                                                            "text-right font-semibold pr-4",
                                                            itemSavingLoss === undefined ? "text-gray-500" :
                                                            itemSavingLoss > 0 ? "text-green-600" :
                                                            itemSavingLoss < 0 ? "text-red-600" :
                                                            "text-gray-600"
                                                        )}>
                                                            {formatToIndianRupee(itemSavingLoss)}
                                                            {itemSavingLoss !== undefined && itemSavingLoss > 0 ? ' (S)' : itemSavingLoss !== undefined && itemSavingLoss < 0 ? ' (L)' : ''}
                                                        </TableCell>
                                                    </TableRow>
                                                );
                                            })}
                                        </TableBody>
                                    </Table>
                                </CardContent>
                            </AccordionContent>
                        </AccordionItem>
                    );
                })}
            </Accordion>
        </div>
    );
};