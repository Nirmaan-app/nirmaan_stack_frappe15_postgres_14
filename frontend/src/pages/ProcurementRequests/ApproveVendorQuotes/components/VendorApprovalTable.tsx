import * as React from 'react';
import { useCallback } from 'react';
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { SelectionState, VendorGroupForTable, VendorItemDetailsToDisplay } from '../types'; // Assuming types are defined in a shared location
import formatToIndianRupee, { formatToRoundedIndianRupee } from '@/utils/FormatPrice'; // Adjust path
import { HistoricalQuotesHoverCard } from '../../VendorQuotesSelection/components/HistoricalQuotesHoverCard';
import { parseNumber } from '@/utils/parseNumber';

interface VendorApprovalTableProps {
    dataSource: VendorGroupForTable[];
    // Receive the selection state directly from the parent
    selection: SelectionState;
    // Callback to update the parent's selection state
    onSelectionChange: (newSelection: SelectionState) => void;
    // Keep accordion state internal for simplicity unless external control is needed
    // expandedVendorIds?: string[];
    // onExpandedChange?: (expandedIds: string[]) => void;
}

export const VendorApprovalTable: React.FC<VendorApprovalTableProps> = ({
    dataSource = [],
    selection, // Use the passed selection state
    onSelectionChange,
}) => {
    // State for controlling accordion expansion remains internal
    const [openAccordionItems, setOpenAccordionItems] = React.useState<string[]>([]);

    // --- Selection Handlers ---
    // These handlers now calculate the *next* state and call onSelectionChange

    const handleVendorCheckChange = useCallback((
        vendorId: string,
        allItemsForVendor: VendorItemDetailsToDisplay[],
        isChecked: boolean | 'indeterminate'
    ) => {
        // Create a mutable copy of the current selection state passed from parent
        const newSelection = new Map(selection);

        if (isChecked === true) {
            // Calculate the set of all item IDs for this vendor
            const allItemIds = new Set(allItemsForVendor.map(item => item.item_id!));
            // Set this vendor's selection to all items
            newSelection.set(vendorId, allItemIds);

            setOpenAccordionItems(prev => Array.from(new Set([...prev, vendorId])))
        } else {
            // Deselect all: remove this vendor's entry from the map
            newSelection.delete(vendorId);
            setOpenAccordionItems(prev => prev.filter(v => v != vendorId))
        }
        // Call the parent's handler with the newly calculated state
        onSelectionChange(newSelection);
    }, [selection, onSelectionChange]); // Depend on current selection and the callback

    const handleItemCheckChange = useCallback((
        vendorId: string,
        itemId: string,
        isChecked: boolean | 'indeterminate'
    ) => {
        // Create a mutable copy of the current selection state
        const newSelection = new Map(selection);
        // Get the current set for the vendor, or create a new one if it doesn't exist yet
        const vendorSet = new Set(newSelection.get(vendorId) ?? []); // Clone the existing set or start fresh

        if (isChecked === true) {
            // Add the item to the set
            vendorSet.add(itemId);
        } else {
            // Remove the item from the set
            vendorSet.delete(itemId);
        }

        if (vendorSet.size === 0) {
            // If the set became empty, remove the vendor entry from the map
            newSelection.delete(vendorId);
        } else {
            // Otherwise, update the map with the modified set for this vendor
            newSelection.set(vendorId, vendorSet);
        }
        // Call the parent's handler with the newly calculated state
        onSelectionChange(newSelection);
    }, [selection, onSelectionChange]); // Depend on current selection and the callback

    // --- Helper to determine Vendor Checkbox State ---
    const getVendorCheckboxState = useCallback((
        vendorId: string,
        totalItemsCount: number
    ): { checked: boolean | 'indeterminate', isFullySelected: boolean } => {
        const selectedVendorSet = selection.get(vendorId); // Use prop
        const selectedCount = selectedVendorSet?.size ?? 0;

        if (selectedCount === 0) {
            return { checked: false, isFullySelected: false };
        } else if (selectedCount === totalItemsCount) {
            return { checked: true, isFullySelected: true };
        } else {
            return { checked: 'indeterminate', isFullySelected: false };
        }
    }, [selection]); // Depend on the selection prop


    // --- Render Logic ---
    if (!dataSource || dataSource.length === 0) {
        return <div className="p-4 text-center text-muted-foreground">No vendor data to display.</div>;
    }

    console.log("VendorApprovalTable dataSource", dataSource);

    return (
        <div className="space-y-3">
            <Accordion
                type="multiple" // Allow multiple vendors to be expanded
                value={openAccordionItems}
                onValueChange={setOpenAccordionItems} // Update state when items open/close
                className="w-full space-y-2"
            >
                {dataSource.map((vendorItem) => {
                    const { vendorId, vendorName, totalAmount, items, key, potentialSavingLossForVendor } = vendorItem;
                    // Calculate state based on the selection prop
                    const vendorState = getVendorCheckboxState(vendorId, items.length);

                    return (
                        <AccordionItem value={vendorId} key={key} className="border rounded-md overflow-hidden bg-white shadow-sm">
                            {/* Custom Trigger using CardHeader structure */}
                            <AccordionTrigger className={`!py-0 !px-0 hover:!no-underline focus-visible:!ring-1 focus-visible:!ring-ring focus-visible:!ring-offset-1 rounded-t-md ${vendorState.isFullySelected ? "bg-primary/10" : ""}`}>
                                <CardHeader className="flex flex-row items-center justify-between p-3 w-full cursor-pointer hover:bg-muted/50 transition-colors">
                                    {/* Left Side: Checkbox and Vendor Name */}
                                    <div className="flex items-center gap-3">
                                        <Checkbox
                                            id={`vendor-${vendorId}`}
                                            checked={vendorState.checked} // Use calculated state
                                            // Use 'intermediate' attribute if Checkbox supports it,
                                            // otherwise rely on visual styling if needed.
                                            // For ShadCN, we might need a ref (see below if needed)
                                            onCheckedChange={(checkedState) => handleVendorCheckChange(vendorId, items, checkedState)}
                                            onClick={(e) => e.stopPropagation()}
                                            aria-label={`Select all items for ${vendorName}`}
                                            className="ml-1"
                                        />
                                        <CardTitle className={cn("text-base font-medium", 'text-primary')}>
                                            {vendorName}
                                        </CardTitle>
                                    </div>
                                    {/* Right Side: Totals and Savings */}
                                    <div className="flex flex-col items-end gap-2 text-xs">
                                        {potentialSavingLossForVendor !== undefined && (
                                            <div className='flex gap-2 items-end'>
                                                <span className='text-gray-500'>Potential Saving/Loss:</span>
                                                <span className={cn(
                                                    "font-semibold",
                                                    potentialSavingLossForVendor > 0 ? "text-green-600" : potentialSavingLossForVendor < 0 ? "text-red-600" : "text-gray-600"
                                                )}>
                                                    {formatToIndianRupee(potentialSavingLossForVendor || "N/A")} {potentialSavingLossForVendor > 0 ? '(S)' : potentialSavingLossForVendor < 0 ? '(L)' : ''}
                                                </span>
                                            </div>
                                        )}
                                        <div className='flex items-end gap-2'>
                                            <span className='text-gray-500'>Total Value:</span>
                                            <span className="font-semibold text-gray-700">
                                                {formatToRoundedIndianRupee(totalAmount)}
                                            </span>
                                        </div>
                                        {/* Icon is handled by AccordionTrigger */}
                                        {/* Remove manual icon if AccordionTrigger provides one */}
                                        {/* <ChevronDown className={cn("h-4 w-4 transition-transform duration-200", isExpanded ? "rotate-180" : "")} /> */}
                                    </div>
                                </CardHeader>
                            </AccordionTrigger>

                            {/* Content: The Table */}
                            <AccordionContent className="overflow-auto">
                                <CardContent className="p-0 ">
                                    <Table>
                                        <TableHeader className="bg-primary/20">
                                            <TableRow>
                                                <TableHead className="w-10 px-2"> {/* Checkbox column */} </TableHead>
                                                <TableHead className="w-[25%] text-primary">Item Name</TableHead>
                                                <TableHead className="w-[8%] text-center">UOM</TableHead>
                                                <TableHead className="w-[8%] text-center">Qty</TableHead>
                                                <TableHead className="w-[8%] text-right">Rate</TableHead>
                                                <TableHead className="w-[8%] text-right">Target Rate</TableHead>
                                                <TableHead className="w-[12%] text-right">Amount</TableHead>
                                                <TableHead className="w-[12%] text-right">Lowest Quoted</TableHead>
                                                <TableHead className="w-[12%] text-right">Target Amount</TableHead>
                                                <TableHead className="w-[13%] text-right pr-4">Savings/Loss</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {items.map((item) => {
                                                // Determine if item selected based on passed 'selection' prop
                                                const isItemSelected = selection.get(vendorId)?.has(item.item_id) ?? false;
                                                // const itemSavingLoss = ((item.lowestQuotedAmount || item.targetAmount) && item.amount)
                                                //                        ? parseNumber(item.lowestQuotedAmount || item.targetAmount) - item.amount
                                                //                        : undefined;
                                                const itemSavingLoss = item.savingLoss

                                                return (
                                                    <TableRow key={item.name}>
                                                        <TableCell className="px-4">
                                                            <Checkbox
                                                                id={`item-${vendorId}-${item.name}`}
                                                                checked={isItemSelected} // Use checked state from prop
                                                                onCheckedChange={(checkedState) => handleItemCheckChange(vendorId, item.item_id!, checkedState)}
                                                                aria-label={`Select item ${item.item_name}`}
                                                            />
                                                        </TableCell>
                                                        {/* ... rest of the TableCells ... */}
                                                        <TableCell className="font-medium text-gray-900">
                                                            {item.item_name}
                                                            {/* Conditionally display Make with specific styling */}
                                                            {item.make && (
                                                                <span className="ml-1 text-red-700 font-light text-xs">({item.make})</span>
                                                            )}
                                                        </TableCell>
                                                        <TableCell className="text-center">{item.unit}</TableCell>
                                                        <TableCell className="text-center">{item.quantity}</TableCell>
                                                        <TableCell className="text-right">{formatToIndianRupee(item.quote)}</TableCell>

                                                        <TableCell className="text-right">
                                                            {parseNumber(item?.targetRate) > 0 ? (
                                                                // Wrap the formatted rate with the HoverCard component
                                                                <HistoricalQuotesHoverCard quotes={item.contributingHistoricalQuotes}>
                                                                    {/* This is the trigger element */}
                                                                    <span>{formatToIndianRupee(parseNumber(item.targetRate) * 0.98)}</span>
                                                                </HistoricalQuotesHoverCard>
                                                            ) : (
                                                                // Display N/A if no target rate could be calculated
                                                                <span>N/A</span>
                                                            )}
                                                        </TableCell>
                                                        {/* <TableCell className="text-right">{formatToIndianRupee(item.targetRate)}</TableCell> */}
                                                        <TableCell className="text-right">{formatToIndianRupee(item.amount)}</TableCell>
                                                        <TableCell className="text-right">{formatToIndianRupee(item.lowestQuotedAmountForItem || "N/A")}</TableCell>
                                                        <TableCell className="text-right">{formatToIndianRupee((parseNumber(item?.targetAmount) * 0.98) || "N/A")}</TableCell>
                                                        <TableCell className={cn(
                                                            "text-right font-semibold pr-4",
                                                            itemSavingLoss === undefined ? "text-gray-500" :
                                                                itemSavingLoss > 0 ? "text-green-600" :
                                                                    itemSavingLoss < 0 ? "text-red-600" :
                                                                        "text-gray-600"
                                                        )}>
                                                            {formatToIndianRupee(itemSavingLoss || "N/A")}
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