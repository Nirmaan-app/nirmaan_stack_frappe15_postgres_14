// src/features/procurement-requests/components/NewItemDialog.tsx
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import ReactSelect, { SingleValue } from 'react-select';
import { v4 as uuidv4 } from 'uuid';
import { useFrappeCreateDoc } from 'frappe-react-sdk';

import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogFooter,
} from "@/components/ui/alert-dialog"; // Adjust path
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectUnit } from "@/components/helpers/SelectUnit"; // Adjust path
import { useToast } from "@/components/ui/use-toast"; // Adjust path
import { TailSpin } from 'react-loader-spinner';
import { ListChecks, CirclePlus } from "lucide-react";

import { ProcurementRequestItem, CategoryOption } from '../types'; // Adjust path
import { useUserData } from '@/hooks/useUserData'; // Adjust path
import Fuse, { FuseResult } from 'fuse.js';
import { ItemStatus } from '../constants';
import { Items } from '@/types/NirmaanStack/Items';
import { Category } from '@/types/NirmaanStack/Category';


interface NewItemDialogProps {
    isOpen: boolean;
    onOpenChange: (isOpen: boolean) => void;
    categories: Category[]; // Full category details needed for new_items check
    workPackage: string; // Display only
    // Callback to add the item (created or requested) to the Zustand store list
    onSubmit: (itemData: Omit<ProcurementRequestItem, "uniqueId" | "status">, isRequest?: boolean) => void
    fuzzySearch: (input: string) => FuseResult<Items>[];
    itemList?: Items[]; // Full item list for fuzzy search display & adding existing
    itemMutate: () => Promise<any>; // To refresh item list after creation
}

// Helper type for local state
interface NewItemState {
    itemName: string;
    unitName: string;
    quantity: string; // Keep as string for input control
    comment: string;
}

const initialNewItemState: NewItemState = {
    itemName: '',
    unitName: '',
    quantity: '',
    comment: '',
};

export const NewItemDialog: React.FC<NewItemDialogProps> = ({
    isOpen,
    onOpenChange,
    categories,
    workPackage,
    onSubmit,
    fuzzySearch,
    itemList,
    itemMutate,
}) => {
    const { toast } = useToast();
    const userData = useUserData();
    const { createDoc, loading: createLoading } = useFrappeCreateDoc();

    // Local State for the dialog form
    const [selectedCategory, setSelectedCategory] = useState<SingleValue<CategoryOption>>(null);
    const [newItem, setNewItem] = useState<NewItemState>(initialNewItemState);
    const [fuzzyMatches, setFuzzyMatches] = useState<FuseResult<Items>[]>([]);
    const [isFocused, setIsFocused] = useState(false); // Track focus for fuzzy list

    // Derived state and options
    const catOptions: CategoryOption[] = useMemo(() => {
         return categories?.map(cat => ({
            value: cat.name, // Use name (DocType key) as value
            label: cat.category_name,
            tax: parseFloat(cat.tax || "0"),
            newItemsDisabled: cat.new_items === "false" && userData?.role !== "Nirmaan Admin Profile" // Calculate disabled flag
        })) || [];
    }, [categories, userData?.role]);

    const isNewItemsDisabled = useMemo(() => selectedCategory?.newItemsDisabled ?? false, [selectedCategory]);

    // Reset form when dialog opens or category changes
    useEffect(() => {
        if (isOpen) {
            // Reset everything except maybe category if desired
            setSelectedCategory(null);
            setNewItem(initialNewItemState);
            setFuzzyMatches([]);
        }
    }, [isOpen]);

     // Reset item details when category changes
    useEffect(() => {
        setNewItem(initialNewItemState);
        setFuzzyMatches([]);
    }, [selectedCategory]);


    // Handlers
    const handleInputChange = (field: keyof NewItemState, value: string) => {
        setNewItem(prev => ({ ...prev, [field]: value }));
        if (field === 'itemName') {
            setFuzzyMatches(fuzzySearch(value));
        }
    };

     const handleUnitChange = (value: string) => {
         setNewItem(prev => ({ ...prev, unitName: value }));
     };

    const closeDialog = useCallback(() => {
        onOpenChange(false);
    }, [onOpenChange]);

    const handleSelectExistingItem = (item: Items) => {
         if (!selectedCategory) return; // Should not happen if fuzzy results are shown

         // Call the onSubmit prop to add *this existing* item to the list
         onSubmit({
            name: item.name,
            item: item.item_name,
            unit: item.unit_name || 'N/A',
            quantity: 1, // Default quantity to 1, user can edit later
            category: selectedCategory.value,
            tax: selectedCategory.tax,
            comment: '', // No comment initially
            // status: ItemStatus.PENDING, // It's an existing item
            // uniqueId: uuidv4(), // will be added by addProcItem in the store
            // work_package: currentSelectedWP // will be added by addProcItem in the store
         }, false); // false indicates it's not a request

         closeDialog();
         toast({ title: `Existing Item "${item.item_name}" added.`, description: "Adjust quantity/comment in the list.", variant: "success" });
     };


    const handleConfirm = async (isRequest: boolean) => {
        if (!selectedCategory || !newItem.itemName || !newItem.unitName || !newItem.quantity || parseFloat(newItem.quantity) <= 0) {
            toast({ title: "Validation Error", description: "Please fill all required fields (*) with valid values.", variant: "destructive" });
            return;
        }

        const quantity = parseFloat(newItem.quantity);

        if (isRequest) {
            // --- Handle as a Request Item ---
            const requestItemData: Omit<ProcurementRequestItem, "uniqueId" | "status"> = {
                name: `REQ-${uuidv4()}`, // Generate a temporary unique ID for requests
                item: newItem.itemName.trim(),
                unit: newItem.unitName,
                quantity: quantity,
                category: selectedCategory.value,
                tax: selectedCategory.tax,
                comment: newItem.comment.trim() || undefined,
                // status: ItemStatus.REQUEST,
                // uniqueId: uuidv4(), // Add client-side unique ID
            };
            onSubmit(requestItemData, true); // True indicates it's a request
            closeDialog();
        } else {
            // --- Handle as a New Item Creation ---
            try {
                const itemDocData = {
                    item_name: newItem.itemName.trim(),
                    unit_name: newItem.unitName,
                    category: selectedCategory.value,
                    // Add other default fields for 'Items' doctype if necessary
                };

                const res = await createDoc("Items", itemDocData);

                // Now add this newly created item to the PR list via the callback
                const newItemForList: Omit<ProcurementRequestItem, "uniqueId" | "status"> = {
                    name: res.name, // Use the actual DocName from response
                    item: res.item_name,
                    unit: res.unit_name,
                    quantity: quantity,
                    category: res.category,
                    tax: selectedCategory.tax, // Get tax from selected category
                    comment: newItem.comment.trim() || undefined,
                    // status: ItemStatus.PENDING,
                    // uniqueId: uuidv4(),
                };
                onSubmit(newItemForList, false); // False indicates it's not a request

                await itemMutate(); // Refresh the main item list query
                toast({
                    title: "Item Created & Added",
                    description: `New Item "${res.item_name}" added to your request list.`,
                    variant: "success",
                });
                closeDialog();

            } catch (error: any) {
                console.error("Failed to create item:", error);
                toast({
                    title: "Item Creation Failed",
                    description: error.message || "Could not create the new item.",
                    variant: "destructive",
                });
            }
        }
    };

    return (
        <AlertDialog open={isOpen} onOpenChange={onOpenChange}>
            <AlertDialogContent className="sm:max-w-lg">
                <AlertDialogHeader className="text-left pb-0">
                    <AlertDialogTitle>
                        Create or Request New Item for <span className="text-primary">{workPackage}</span>
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                        Fill in the details for the new item. If creation is disabled for the category, it will be added as a request.
                    </AlertDialogDescription>
                </AlertDialogHeader>

                <div className="flex flex-col gap-4 py-4">
                    {/* Category Select */}
                    <div className="flex flex-col gap-1">
                        <label htmlFor="newItemCategory" className="dialog-label">
                            Category <sup className="text-red-500">*</sup>
                        </label>
                        <ReactSelect
                            inputId='newItemCategory'
                            placeholder="Select Category..."
                            value={selectedCategory}
                            options={catOptions}
                            onChange={(selectedOption) => setSelectedCategory(selectedOption)}
                            isClearable
                        />
                        {isNewItemsDisabled && (
                            <p className="text-xs text-red-500 px-1 mt-1">
                                New item creation is disabled for this category by Admin. This item will be added as a 'Request'.
                            </p>
                        )}
                    </div>

                    {/* Item Name Input & Fuzzy Search */}
                    <div className="flex flex-col gap-1 relative">
                        <label htmlFor="itemName" className="dialog-label">
                            Item Name <sup className="text-red-500">*</sup>
                        </label>
                        <Input
                            id="itemName"
                            placeholder="Enter Item Name..."
                            disabled={!selectedCategory}
                            value={newItem.itemName}
                            onChange={(e) => handleInputChange('itemName', e.target.value)}
                            autoComplete="off"
                            onFocus={() => setIsFocused(true)}
                            onBlur={() => setTimeout(() => setIsFocused(false), 150)} // Delay blur to allow clicking list
                        />
                        {/* Fuzzy Search Results */}
                        {isFocused && fuzzyMatches.length > 0 && selectedCategory && (
                            <ul className="absolute z-20 mt-1 top-full left-0 right-0 bg-white border border-gray-300 rounded-md shadow-lg max-h-40 w-full overflow-y-auto">
                                <li className='px-2 py-1 text-xs font-semibold text-gray-500 bg-gray-50'>Similar Existing Items:</li>
                                {fuzzyMatches.slice(0, 5).map(({ item, score }) => (
                                     <li
                                        key={item.name}
                                        className="p-2 hover:bg-gray-100 flex justify-between items-center text-sm cursor-default"
                                        // Use onMouseDown to trigger before input blur
                                        onMouseDown={() => handleSelectExistingItem(item)}
                                    >
                                        <div className="flex flex-col gap-0.5">
                                            <strong className='text-gray-800'>{item.item_name}</strong>
                                            <span className="text-xs text-gray-500">
                                                (Category: {item.category}, Unit: {item.unit_name || 'N/A'})
                                            </span>
                                        </div>
                                        <Button variant="outline" size="sm" className="flex items-center gap-1 h-6 px-2 py-0.5 text-primary border-primary hover:bg-primary/5">
                                            <CirclePlus className="w-3 h-3" /> Add
                                        </Button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>


                    {/* Unit & Quantity */}
                    <div className="grid grid-cols-2 gap-4 items-end">
                        <div className="flex flex-col gap-1">
                            <label htmlFor="itemUnit" className="dialog-label">
                                Item Unit <sup className="text-red-500">*</sup>
                            </label>
                            <SelectUnit
                                value={newItem.unitName}
                                disabled={!selectedCategory}
                                onChange={handleUnitChange}
                            />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label htmlFor="quantity" className="dialog-label">
                                Quantity <sup className="text-red-500">*</sup>
                            </label>
                            <Input
                                id="quantity"
                                type="number"
                                placeholder='0.00'
                                inputMode='decimal'
                                min="0"
                                step="any"
                                disabled={!selectedCategory}
                                value={newItem.quantity}
                                onChange={(e) => handleInputChange('quantity', e.target.value)}
                            />
                        </div>
                    </div>

                    {/* Comment */}
                    <div className="flex flex-col gap-1">
                        <label htmlFor="comment" className="dialog-label">
                            Comment (Optional)
                        </label>
                        <Input
                            id="comment"
                            placeholder="Add any notes..."
                            disabled={!selectedCategory}
                            value={newItem.comment}
                            onChange={(e) => handleInputChange('comment', e.target.value)}
                        />
                    </div>
                </div>

                <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    {/* Conditionally render button based on isNewItemsDisabled */}
                    {isNewItemsDisabled ? (
                         <Button
                            disabled={!selectedCategory || !newItem.itemName || !newItem.unitName || !newItem.quantity || parseFloat(newItem.quantity) <= 0}
                            variant="default"
                            onClick={() => handleConfirm(true)} // true = isRequest
                            className=" flex items-center gap-1 min-w-[100px]"
                        >
                             <ListChecks className="h-4 w-4" /> Request Item
                        </Button>
                    ) : (
                        <Button
                            disabled={createLoading || !selectedCategory || !newItem.itemName || !newItem.unitName || !newItem.quantity || parseFloat(newItem.quantity) <= 0}
                            variant="default"
                            onClick={() => handleConfirm(false)} // false = isCreate
                            className=" flex items-center gap-1 min-w-[100px]"
                        >
                             {createLoading ? (
                                <TailSpin width={18} height={18} color="white" />
                            ) : (
                                <>
                                    <ListChecks className="h-4 w-4" /> Create & Add
                                </>
                             )}
                        </Button>
                    )}
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};