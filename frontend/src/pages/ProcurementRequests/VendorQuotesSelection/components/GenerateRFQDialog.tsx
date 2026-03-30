import redlogo from "@/assets/red-logo.png";
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useMakeOptions } from '@/hooks/useMakeOptions';
import { Projects, ProjectWPCategoryMake } from '@/types/NirmaanStack/Projects';
import { formatDate } from '@/utils/FormatDate';
import { useFrappeGetDoc } from 'frappe-react-sdk';
import { FolderPlus, MessageCircleMore } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactSelect from 'react-select';
import { useReactToPrint } from 'react-to-print';
import { getItemListFromDocument, ProgressDocument, ProgressItem } from '../types'
import { useGstOptions } from '@/hooks/useGstOptions';

interface GenerateRFQDialogProps {
    orderData: ProgressDocument;
    projectWpCategoryMakes?: ProjectWPCategoryMake[];
    relevantPackages?: string[];
}

const GenerateRFQDialog: React.FC<GenerateRFQDialogProps> = ({ orderData, projectWpCategoryMakes, relevantPackages }) => {
    const [open, setOpen] = useState(false);
    const [selectedItemsForRfq, setSelectedItemsForRfq] = useState<{ [category: string]: string[] }>({});
    const [selectedMakesForRfq, setSelectedMakesForRfq] = useState<Record<string, string>>({});
    const [isPrinting, setIsPrinting] = useState(false);

    const { data: procurement_project } = useFrappeGetDoc("Projects", orderData?.project)

    const handlePrint = async () => {
        if (!orderData) return;
        setIsPrinting(true);

        const itemNames = Object.values(selectedItemsForRfq).flat();
        const selectionData = {
            items: itemNames,
            makes: selectedMakesForRfq
        };

        const params = new URLSearchParams({
            doctype: "Procurement Requests",
            name: orderData.name,
            format: "Generate RFQ",
            no_letterhead: "0",
            selected_items: JSON.stringify(selectionData)
        });

        const printUrl = `/api/method/frappe.utils.print_format.download_pdf?${params.toString()}`;

        try {
            const response = await fetch(printUrl);
            if (!response.ok) throw new Error('Network response was not ok');
            
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            
            // Construct filename: rfq-PRNUMBER-PROJECTNAME.pdf
            const projectName = procurement_project?.project_name?.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'project';
            const fileName = `rfq-${orderData.name}-${projectName}.pdf`;
            
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            // Close dialog after successful download
            setOpen(false);
        } catch (error) {
            console.error('Error downloading PDF:', error);
        } finally {
            setIsPrinting(false);
        }
    };

    // Use helper functions to get item and category lists
    const currentItemList = useMemo(() => getItemListFromDocument(orderData), [orderData]);
    const currentCategoryList = useMemo(() => {
        const seen = new Set<string>();
        return currentItemList.filter(item => {
            if (seen.has(item.category)) return false;
            seen.add(item.category);
            return true;
        }).map(item => ({ name: item.category }));
    }, [currentItemList]);

    const handleItemSelection = useCallback((categoryName: string, itemName: string) => {
        setSelectedItemsForRfq((prevSelected) => {
            const categoryItems = prevSelected[categoryName] || [];
            if (categoryItems.includes(itemName)) {
                return { ...prevSelected, [categoryName]: categoryItems.filter((item) => item !== itemName) };
            } else {
                return { ...prevSelected, [categoryName]: [...categoryItems, itemName] };
            }
        });
    }, []);


    const handleCategorySelection = useCallback((categoryName: string) => {
        const itemsInThisCategory = currentItemList.filter(item => item.category === categoryName);
        const categoryItemNames = itemsInThisCategory.map((item) => item.name);

        setSelectedItemsForRfq((prevSelected) => {
            const currentCategorySelection = prevSelected[categoryName] || [];
            const allCurrentlySelectedInCategory = categoryItemNames.every((itemName) => currentCategorySelection.includes(itemName)) && categoryItemNames.length === currentCategorySelection.length;

            if (allCurrentlySelectedInCategory && categoryItemNames.length > 0) { // If all are selected, deselect all for this category
                const newSelected = { ...prevSelected };
                delete newSelected[categoryName]; // Or set to [] : newSelected[categoryName] = [];
                return newSelected;
            } else { // Otherwise, select all for this category
                return { ...prevSelected, [categoryName]: categoryItemNames };
            }
        });
    }, [currentItemList]);


    const handleSelectAll = useCallback(() => {
        if (currentCategoryList.length === 0 || currentItemList.length === 0) return;

        const allSelectedFromCategories: { [category: string]: string[] } = {};
        currentCategoryList.forEach((category) => {
            const itemsInThisCategory = currentItemList.filter((item) => item.category === category.name);
            allSelectedFromCategories[category.name] = itemsInThisCategory.map((item) => item.name);
        });

        // Check if everything is already selected
        const totalItemsInDoc = currentItemList.length;
        const totalCurrentlySelected = Object.values(selectedItemsForRfq).flat().length;

        if (totalCurrentlySelected === totalItemsInDoc && totalItemsInDoc > 0) {
            setSelectedItemsForRfq({}); // Deselect all
        } else {
            setSelectedItemsForRfq(allSelectedFromCategories); // Select all
        }
    }, [currentCategoryList, currentItemList, selectedItemsForRfq]);


    const isItemSelected = useCallback((categoryName: string, itemName: string) => {
        return selectedItemsForRfq[categoryName]?.includes(itemName) || false;
    }, [selectedItemsForRfq]);

    const isCategoryFullySelected = useCallback((categoryName: string) => {
        const itemsInThisCategory = currentItemList.filter(item => item.category === categoryName);
        if (itemsInThisCategory.length === 0) return false; // Cannot be fully selected if no items
        const selectedInThisCategory = selectedItemsForRfq[categoryName] || [];
        return itemsInThisCategory.length === selectedInThisCategory.length &&
            itemsInThisCategory.every(item => selectedInThisCategory.includes(item.name));
    }, [currentItemList, selectedItemsForRfq]);


    // Initialize default makes from item data when dialog opens
    useEffect(() => {
        if (open && currentItemList.length > 0) {
            setSelectedMakesForRfq((prev) => {
                const updated = { ...prev };
                let changed = false;
                currentItemList.forEach((item) => {
                    if (!(item.name in updated)) {
                        updated[item.name] = item.make || "";
                        changed = true;
                    }
                });
                return changed ? updated : prev;
            });
        }
    }, [open, currentItemList]);

    const handleMakeChangeForRfq = useCallback((itemName: string, make: string) => {
        setSelectedMakesForRfq((prev) => ({ ...prev, [itemName]: make }));
    }, []);

    const totalItemsInDocument = currentItemList.length;
    const totalSelectedItems = Object.values(selectedItemsForRfq).flat().length;
    const areAllItemsSelected = totalItemsInDocument > 0 && totalSelectedItems === totalItemsInDocument;


    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant={"outline"} size="sm" className="text-primary border-primary flex gap-1 items-center">
                    <FolderPlus className="w-4 h-4" />
                    Generate RFQ
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle className='text-center text-primary'>Generate RFQ for {orderData?.name}</DialogTitle>
                    <DialogDescription className="text-center text-sm">
                        Select items to include in the RFQ document.
                    </DialogDescription>
                </DialogHeader>
                {orderData && (
                    <div className='flex-grow space-y-4 overflow-y-auto pr-2'> {/* Make this section scrollable */}
                        {currentCategoryList.length > 0 && currentItemList.length > 0 && (
                            <div className="flex items-center py-2 border-b">
                                <Checkbox
                                    id="select-all-rfq-items"
                                    checked={areAllItemsSelected}
                                    onCheckedChange={handleSelectAll}
                                />
                                <Label htmlFor="select-all-rfq-items" className="ml-2 font-semibold text-sm">
                                    {areAllItemsSelected ? 'Deselect All Items' : 'Select All Items'} ({totalSelectedItems}/{totalItemsInDocument})
                                </Label>
                            </div>
                        )}

                        {currentCategoryList.map((category) => {
                            const itemsInThisCategory = currentItemList.filter((item) => item.category === category.name);
                            if (itemsInThisCategory.length === 0) return null;

                            return (
                                <div key={category.name}>
                                    <div className="flex items-center mb-2 border-b pb-1.5">
                                        <Checkbox
                                            id={`category-rfq-${category.name}`}
                                            checked={isCategoryFullySelected(category.name)}
                                            onCheckedChange={() => handleCategorySelection(category.name)}
                                        />
                                        <Label htmlFor={`category-rfq-${category.name}`} className="ml-2 font-medium text-sm">
                                            {category.name}
                                        </Label>
                                    </div>
                                    <ul className="ml-4 space-y-1.5">
                                        {itemsInThisCategory.map((item) => (
                                            <RFQItemRow
                                                key={item.name}
                                                item={item}
                                                checked={isItemSelected(category.name, item.name)}
                                                onCheck={() => handleItemSelection(category.name, item.name)}
                                                selectedMake={selectedMakesForRfq[item.name] ?? item.make ?? ""}
                                                onMakeChange={(make) => handleMakeChangeForRfq(item.name, make)}
                                                projectWpCategoryMakes={projectWpCategoryMakes}
                                                relevantPackages={relevantPackages ?? []}
                                            />
                                        ))}
                                    </ul>
                                </div>
                            );
                        })}
                        {currentItemList.length === 0 && <p className="text-muted-foreground text-center py-4">No items available in this document.</p>}
                    </div>
                )}
                <DialogFooter className="mt-auto pt-4 border-t"> {/* Footer sticks to bottom */}
                    <DialogClose asChild>
                        <Button variant="outline">Cancel</Button>
                    </DialogClose>
                    <Button onClick={handlePrint} disabled={totalSelectedItems === 0 || isPrinting}>
                        {isPrinting ? "Generating..." : "Print RFQ"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};



// Sub-component per item row — calls useMakeOptions for the item's category
interface RFQItemRowProps {
    item: ProgressItem;
    checked: boolean;
    onCheck: () => void;
    selectedMake: string;
    onMakeChange: (make: string) => void;
    projectWpCategoryMakes?: ProjectWPCategoryMake[];
    relevantPackages: string[];
}

const RFQItemRow: React.FC<RFQItemRowProps> = ({
    item,
    checked,
    onCheck,
    selectedMake,
    onMakeChange,
    projectWpCategoryMakes,
    relevantPackages,
}) => {
    const { makeOptions, isLoading } = useMakeOptions({
        categoryName: item.category,
        projectWpCategoryMakes,
        relevantPackages,
    });

    const selectedOption = useMemo(
        () => makeOptions.find((o) => o.value === selectedMake) ?? null,
        [makeOptions, selectedMake]
    );

    return (
        <li className="flex items-center gap-2 border-b border-dashed border-gray-200 pb-1.5 last:border-b-0 last:pb-0">
            <Checkbox
                id={`item-rfq-${item.name}`}
                checked={checked}
                onCheckedChange={onCheck}
            />
            <Label htmlFor={`item-rfq-${item.name}`} className="min-w-0 flex-1 text-xs font-normal cursor-pointer truncate">
                {item.item_name}
                <span className="text-muted-foreground text-xs"> ({item.quantity} {item.unit})</span>
            </Label>
            <ReactSelect
                options={makeOptions}
                value={selectedOption}
                onChange={(opt) => onMakeChange(opt?.value || "")}
                className="w-[180px] flex-shrink-0"
                menuPortalTarget={document.body}
                isLoading={isLoading}
                styles={{
                    control: (base) => ({ ...base, minHeight: '30px', fontSize: '12px' }),
                    valueContainer: (base) => ({ ...base, padding: '0 6px' }),
                    input: (base) => ({ ...base, margin: '0', padding: '0' }),
                    indicatorsContainer: (base) => ({ ...base, height: '30px' }),
                    menuPortal: (base) => ({ ...base, zIndex: 9999, pointerEvents: 'auto' as const }),
                    option: (base) => ({ ...base, fontSize: '12px', padding: '6px 10px' }),
                }}
                placeholder="Select make..."
                isClearable
            />
        </li>
    );
};

export default GenerateRFQDialog;