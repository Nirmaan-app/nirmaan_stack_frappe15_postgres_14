import redlogo from "@/assets/red-logo.png";
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Category, ProcurementItem, ProcurementRequest } from '@/types/NirmaanStack/ProcurementRequests';
import { Projects } from '@/types/NirmaanStack/Projects';
import { formatDate } from '@/utils/FormatDate';
import { useFrappeGetDoc } from 'frappe-react-sdk';
import memoize from 'lodash/memoize';
import { FolderPlus, MessageCircleMore } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useReactToPrint } from 'react-to-print';
import { getCategoryListFromDocument, getItemListFromDocument, ProgressDocumentType } from '../types'

interface GenerateRFQDialogProps {
    orderData: ProgressDocumentType;
}

const GenerateRFQDialog: React.FC<GenerateRFQDialogProps> = ({ orderData }) => {
    const [open, setOpen] = useState(false);
    const [selectedItemsForRfq, setSelectedItemsForRfq] = useState<{ [category: string]: string[] }>({});

    const componentRef = useRef<HTMLDivElement>(null);

    const { data: procurement_project } = useFrappeGetDoc("Projects", orderData?.project)

    const handlePrint = useReactToPrint({
        content: () => componentRef.current,
        documentTitle: `RFQ_Preview`,
    });

    // Use helper functions to get item and category lists
    const currentItemList = useMemo(() => getItemListFromDocument(orderData), [orderData]);
    const currentCategoryList = useMemo(() => getCategoryListFromDocument(orderData), [orderData]);

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
            <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
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
                                            <li key={item.name} className="flex items-center border-b border-dashed border-gray-200 pb-1.5 last:border-b-0 last:pb-0">
                                                <Checkbox
                                                    id={`item-rfq-${item.name}`}
                                                    checked={isItemSelected(category.name, item.name)}
                                                    onCheckedChange={() => handleItemSelection(category.name, item.name)}
                                                />
                                                <Label htmlFor={`item-rfq-${item.name}`} className="ml-2 text-xs font-normal cursor-pointer">
                                                    {item.item_name}
                                                    {item.make && <span className="text-muted-foreground text-xs italic"> - {item.make}</span>}
                                                    <span className="text-muted-foreground text-xs"> ({item.quantity} {item.unit})</span>
                                                </Label>
                                            </li>
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
                    <Button onClick={handlePrint} disabled={totalSelectedItems === 0}>
                        Print RFQ
                    </Button>
                </DialogFooter>
                {/* RFQPDf is hidden and used by react-to-print */}
                <RFQPDf componentRef={componentRef} selectedItems={selectedItemsForRfq} orderData={orderData} procurement_project={procurement_project} />
            </DialogContent>
        </Dialog>
    );
};


interface RFQPdfProps {
    componentRef: React.RefObject<HTMLDivElement>;
    selectedItems: { [category: string]: string[] };
    orderData: ProgressDocumentType | undefined;
    procurement_project: Projects | undefined;
}

const RFQPDf: React.FC<RFQPdfProps> = ({ componentRef, selectedItems, orderData, procurement_project }) => {
    const itemListForPdf = useMemo(() => {
        if (!orderData) return [];
        const itemsFromDoc = getItemListFromDocument(orderData);
        const rfqItems: Array<ProcurementItem | SentBackItem> = [];
        Object.keys(selectedItems).forEach((categoryName) => {
            const itemsInCategorySelected = selectedItems[categoryName];
            const itemsFromSource = itemsFromDoc.filter(
                item => item.category === categoryName && itemsInCategorySelected.includes(item.name)
            );
            rfqItems.push(...itemsFromSource);
        });
        return rfqItems;
    }, [orderData, selectedItems]);


    return (
        <div className='hidden'>
            <div ref={componentRef} className="px-4 pb-4">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="w-full border-b border-black">
                            <tr>
                                <th colSpan={5} className="p-0">
                                    <div className="mt-6 flex justify-between">
                                        <div>
                                            <img className="w-44" src={redlogo} alt="Nirmaan" />
                                            <div className="pt-2 text-lg text-gray-500 font-semibold">Nirmaan(Stratos Infra Technologies Pvt. Ltd.)</div>
                                        </div>
                                    </div>
                                </th>
                            </tr>
                            <tr>
                                <th colSpan={5} className="p-0">
                                    <div className="py-2 border-b-2 border-gray-600 pb-3 mb-3">
                                        <div className="flex justify-between">
                                            <div className="text-xs text-gray-500 font-normal">1st Floor, 234, 9th Main, 16th Cross, Sector 6, HSR Layout, Bengaluru - 560102, Karnataka</div>
                                            <div className="text-xs text-gray-500 font-normal">GST: 29ABFCS9095N1Z9</div>
                                        </div>
                                    </div>
                                </th>
                            </tr>
                            <tr>
                                <th colSpan={5} className="p-0">
                                    <div className="grid grid-cols-2 justify-between border border-gray-100 rounded-lg p-4">
                                        <div className="border-0 flex flex-col">
                                            <p className="text-left py-1 font-medium text-xs text-gray-500">Date</p>
                                            <p className="text-left font-bold py-1 font-semibold text-sm text-black">{formatDate(procurement_project?.creation!)}</p>
                                        </div>
                                        <div className="flex flex-col gap-2">
                                            <div className="border-0 flex flex-col ml-10">
                                                <p className="text-left py-1 font-medium text-xs text-gray-500">Project ID</p>
                                                <p className="text-left font-bold py-1 font-semibold text-sm text-black">{procurement_project?.name}</p>
                                            </div>
                                            <div className="border-0 flex flex-col ml-10">
                                                <p className="text-left py-1 font-medium text-xs text-gray-500">Project Address</p>
                                                <p className="text-left font-bold py-1 font-semibold text-sm text-black">{procurement_project?.project_city}, {procurement_project?.project_state}</p>
                                            </div>

                                        </div>
                                    </div>
                                </th>
                            </tr>
                            <tr>
                                <th scope="col" className="px-6 py-3 text-left font-bold text-gray-800 tracking-wider pr-32">Item</th>
                                <th scope="col" className="px-2 py-1 text-left font-bold text-gray-800 tracking-wider">Category</th>
                                <th scope="col" className="px-2 py-1 text-left font-bold text-gray-800 tracking-wider">Unit</th>
                                <th scope="col" className="px-2 py-1 text-left font-bold text-gray-800 tracking-wider">Quantity</th>
                                <th scope="col" className="px-2 py-1 text-left font-bold text-gray-800 tracking-wider">Rate excl. GST</th>
                            </tr>
                        </thead>
                        <tbody>
                            {itemListForPdf.map((i, index) => ( // Iterate over itemListForPdf
                                <tr key={`pdf-item-${i.name}-${index}`}> {/* More unique key */}
                                    <td className="px-6 py-2 text-xs"> {/* Smaller font for PDF table */}
                                        {i.item_name}
                                        {i.make && <div className="text-xxs font-normal">{` - ${i.make}`}</div>} {/* text-xxs if you have it */}
                                        {i.comment && (
                                            <div className="flex gap-1 items-start p-0.5 mt-0.5">
                                                <MessageCircleMore className="w-3 h-3 flex-shrink-0" />
                                                <div className="text-xxs text-gray-500">{i.comment}</div>
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-2 py-2 text-xs whitespace-nowrap">{i.category}</td>
                                    <td className="px-2 py-2 text-xs whitespace-nowrap">{i.unit}</td>
                                    <td className="px-2 py-2 text-xs whitespace-nowrap">{i.quantity}</td>
                                    <td className="px-2 py-2 text-sm whitespace-nowrap">-</td> {/* Rate excl. GST - empty as per example */}
                                </tr>
                            ))}
                            {itemListForPdf.length === 0 && <tr><td colSpan={5} className="text-center p-4">No items selected for RFQ.</td></tr>}
                        </tbody>
                    </table>
                    <div className="pt-24">
                        <p className="text-md font-bold text-red-700 underline">Note</p>
                        <ul className="list-disc ml-4 text-xs">
                            <li>Please share the quotes as soon as possible</li>
                            <li>Please Exclude GST from the rates</li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default GenerateRFQDialog;