// src/features/procurement-requests/components/ItemSelectorControls.tsx
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import ReactSelect, { components, MenuListProps, OptionProps, SingleValue } from 'react-select';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogClose } from "@/components/ui/dialog"; // Adjust path
import { Pencil, CirclePlus } from "lucide-react";
import { CategoryMakesMap, CategoryOption, CategorySelection, ItemOption, MakeOption, ProcurementRequestItem } from '../types'; // Adjust path
import { useUserData } from '@/hooks/useUserData'; // Adjust path
import { Category } from '@/types/NirmaanStack/Category';
import { parseNumber } from '@/utils/parseNumber';
import { Label } from '@/components/ui/label';
import { ManageCategoryMakesDialog } from './ManageCategoryMakesDialog';
import { Makelist } from '@/types/NirmaanStack/Makelist';

// Custom MenuList for ReactSelect to add "Create/Request" button
const CustomMenuList = (props: MenuListProps<ItemOption, false>) => {
    const {
        children,
        selectProps: { 
            onAddItemClick
         }
    } = props;

    return (
        <div>
            <components.MenuList {...props}>
                <div>{children}</div>
            </components.MenuList>
            <div className="sticky bottom-0 z-10 bg-white border-t border-gray-200 px-2 py-1">
                <Button
                    variant="ghost"
                    className="w-full rounded-md flex items-center justify-center gap-1 text-sm h-9 text-blue-600 hover:bg-blue-50"
                    onClick={onAddItemClick}
                    onTouchStart={onAddItemClick}
                >
                    <CirclePlus className="w-4 h-4" />
                    Create/Request New Item
                </Button>
            </div>
        </div>
    );
};

// Custom MenuList for Make Select
export const CustomMakeMenuList = (props: MenuListProps<MakeOption, false>) => {
    const {
        children,
        selectProps: { 
            onManageMakesClick
         } // Access custom props passed via selectProps
    } = props;

    return (
        <div>
            <components.MenuList {...props}>
                <div>{children}</div>
            </components.MenuList>
             {onManageMakesClick && (
                <div className="sticky bottom-0 z-10 bg-white border-t border-gray-200 px-2 py-1">
                    <Button
                        variant="ghost"
                        className="w-full rounded-md flex items-center justify-center gap-1 text-sm h-9 text-blue-600 hover:bg-blue-50"
                        onClick={onManageMakesClick}
                        onTouchStart={onManageMakesClick}
                    >
                        <CirclePlus className="w-4 h-4" />
                        Add Existing / New Make
                    </Button>
                </div>
             )}
        </div>
    );
};



interface ItemSelectorControlsProps {
    selectedWP: string;
    itemOptions: ItemOption[];
    allMakeOptions: MakeOption[];
    selectedCategories: CategorySelection[];
    onAddItem: (itemData: Omit<ProcurementRequestItem, 'uniqueId' | 'status'>) => void; // isRequest removed, handled in hook
    onOpenNewItemDialog: () => void;
    allowWpEdit: boolean;
    onEditWP: () => void;
    disabled?: boolean;
    categoryList?: Category[];
    updateCategoryMakesInStore: (categoryName: string, newMake: string) => void;
    makeList?: Makelist[]; // <<< Pass makeList for AddMakeComponent in dialog
    makeListMutate: () => Promise<any>;
    categoryMakeListMutate?: () => Promise<any>;
    initialCategoryMakes: CategoryMakesMap; // <<< Add baseline makes map from store
}

export const ItemSelectorControls: React.FC<ItemSelectorControlsProps> = ({
    selectedWP,
    itemOptions,
    allMakeOptions,
    selectedCategories,
    onAddItem,
    onOpenNewItemDialog,
    allowWpEdit,
    onEditWP,
    disabled = false,
    categoryList,
    updateCategoryMakesInStore,
    makeList, // <<< Receive makeList
    makeListMutate,
    categoryMakeListMutate,
    initialCategoryMakes, // <<< Receive baseline makes
}) => {
    // --- State ---
    const [curItem, setCurItem] = useState<SingleValue<ItemOption>>(null);
    const [curMake, setCurMake] = useState<SingleValue<MakeOption>>(null);
    const [curQuantity, setCurQuantity] = useState<string>('');
    const [curComment, setCurComment] = useState<string>('');
    const [isManageMakesDialogOpen, setIsManageMakesDialogOpen] = useState(false);
    const userData = useUserData();

    console.log("selectedCategories", selectedCategories)

   // --- Memos and Derived State ---
   const currentItemCategoryName = curItem?.category;

   // --- *** UPDATED LOGIC for availableMakeOptions *** ---
   const availableMakeOptions = useMemo(() => {
       if (!currentItemCategoryName) {
           console.log("No item selected, no make options.");
           return [];
       }

       let makesForCategory: string[] = [];

       // 1. Try to find the category in the derived `selectedCategories` (includes session changes)
       const derivedCategoryDetails = selectedCategories.find(c => c.name === currentItemCategoryName);

       if (derivedCategoryDetails && Array.isArray(derivedCategoryDetails.makes)) {
            console.log(`Using makes from derived selectedCategories for ${currentItemCategoryName}:`, derivedCategoryDetails.makes);
           makesForCategory = derivedCategoryDetails.makes;
       }
       // 2. If not found in derived state, fall back to the initial baseline makes for the WP
       else if (initialCategoryMakes && initialCategoryMakes[currentItemCategoryName]) {
            console.log(`Falling back to initialCategoryMakes for ${currentItemCategoryName}:`, initialCategoryMakes[currentItemCategoryName]);
           makesForCategory = initialCategoryMakes[currentItemCategoryName];
       } else {
           console.log(`No makes found for category ${currentItemCategoryName} in selectedCategories or initialCategoryMakes.`);
       }

       // Ensure it's an array
       const makesSet = new Set(Array.isArray(makesForCategory) ? makesForCategory : []);

       // 3. Filter all system makes based on the determined set
       const filteredOptions = allMakeOptions.filter(opt => makesSet.has(opt.value));

       return filteredOptions;
   }, [currentItemCategoryName, selectedCategories, initialCategoryMakes, allMakeOptions]); // <<< Add initialCategoryMakes dependency


    const isNewItemsDisabled = useMemo(() => {
        if (!curItem?.category || !categoryList) return false;
        const categoryDetails = categoryList.find(c => c.name === curItem.category);
        return categoryDetails?.new_items === "false" && userData?.role !== "Nirmaan Admin Profile";
    }, [curItem, categoryList, userData?.role]);

    // --- Handlers ---
    const handleItemChange = useCallback((selectedOption: SingleValue<ItemOption>) => {
        setCurItem(selectedOption);
        setCurMake(null);
        setCurQuantity('');
        setCurComment('');
    }, []); // No dependencies needed if it only sets state

    const handleAddItemClick = useCallback(() => {
        if (!curItem || !curQuantity || parseNumber(curQuantity) <= 0) {
            alert("Please select an item and enter a valid quantity.");
            return;
        }
        onAddItem({
            name: curItem.value, item: curItem.label, unit: curItem.unit,
            quantity: parseFloat(curQuantity), category: curItem.category,
            tax: curItem.tax, make: curMake?.value || undefined,
            comment: curComment.trim() || undefined,
        });
        setCurItem(null); setCurMake(null); setCurQuantity(''); setCurComment('');
    }, [curItem, curQuantity, curMake, curComment, onAddItem]); // Dependencies needed

    const handleOpenManageMakesDialog = useCallback(() => {
        if (!curItem?.category) {
            alert("Please select an item first to manage makes for its category.");
            return;
        }
        setIsManageMakesDialogOpen(true);
    }, [curItem]); // Dependency needed

    const handleMakesManaged = useCallback((newlyAssociatedMakes: MakeOption[]) => {
        if (!currentItemCategoryName) return;
        newlyAssociatedMakes.forEach(make => {
            updateCategoryMakesInStore(currentItemCategoryName, make.value);
        });
        // Optional: Auto-select the first new make
        // if (newlyAssociatedMakes.length > 0) {
        //    const firstNewMake = allMakeOptions.find(opt => opt.value === newlyAssociatedMakes[0].value);
        //    if (firstNewMake) setCurMake(firstNewMake);
        // }
        setIsManageMakesDialogOpen(false);
    }, [currentItemCategoryName, updateCategoryMakesInStore, allMakeOptions]); // Dependencies needed

    // --- Custom Props for Select ---
    const itemSelectCustomProps = { onOpenNewItemDialog, isNewItemsDisabled };
    const makeSelectCustomProps = { onManageMakesClick: handleOpenManageMakesDialog };

    return (
        <div className='space-y-4'>
            {/* Work Package Display (No changes) */}
            <div className="flex items-center justify-between">
                 {/* ... */}
                 <div className="space-y-1">
                    <h3 className="max-sm:text-xs font-semibold text-gray-400">Package</h3>
                    <div className="flex items-center gap-2">
                        <span className="font-semibold max-sm:text-sm">{selectedWP}</span>
                        {allowWpEdit && (
                            <Dialog>
                                <DialogTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-5 w-5 text-blue-600 hover:bg-blue-50 p-0">
                                         <Pencil className="h-4 w-4" />
                                    </Button>
                                </DialogTrigger>
                                <DialogContent className="sm:max-w-[425px]">
                                     <DialogHeader>
                                         <DialogTitle>Reset Order List?</DialogTitle>
                                         <DialogDescription>
                                             Changing the work package will clear your current item list. Are you sure?
                                         </DialogDescription>
                                     </DialogHeader>
                                     <div className="flex items-center justify-center gap-4 pt-2">
                                         <DialogClose asChild>
                                              <Button variant="outline" size="sm">No</Button>
                                         </DialogClose>
                                         <Button size="sm" onClick={onEditWP}>Yes, Change</Button>
                                     </div>
                                </DialogContent>
                            </Dialog>
                        )}
                    </div>
                </div>
            </div>

            {/* --- Item Selector --- */}
            <div>
                <Label htmlFor="item-select" className="block text-sm font-medium text-gray-700 mb-1">Item <sup className="text-red-500">*</sup></Label>
                <ReactSelect
                    inputId='item-select'
                    placeholder={"Select or Create/Request Item..."}
                    value={curItem}
                    isDisabled={disabled}
                    options={itemOptions}
                    onChange={handleItemChange}
                    onAddItemClick={onOpenNewItemDialog}
                    components={{ MenuList: CustomMenuList }} // Use CustomMenuList for Item
                    selectProps={{ customProps: itemSelectCustomProps }}
                    isClearable
                />
            </div>

            {/* --- Row for Make / Qty / Unit --- */}
            <div className="flex flex-col sm:flex-row items-end gap-4">
                {/* Make Selector (Half Width on Medium screens and up) */}
                <div className="w-full sm:w-1/2">
                    <Label htmlFor="make-select" className="block text-sm font-medium text-gray-700 mb-1">Make (Optional)</Label>
                    <ReactSelect
                        inputId='make-select'
                        placeholder={!curItem ? "Select item first" : "Select or Add Make..."}
                        value={curMake}
                        isDisabled={disabled || !curItem}
                        options={availableMakeOptions}
                        onChange={(selectedOption) => setCurMake(selectedOption)}
                        onManageMakesClick={handleOpenManageMakesDialog}
                        components={{ MenuList: CustomMakeMenuList }} // Use CustomMakeMenuList for Make
                        selectProps={{ customProps: makeSelectCustomProps }}
                        isClearable
                    />
                </div>

                {/* Qty Input (Quarter Width) */}
                <div className="w-full sm:w-1/4">
                    <Label htmlFor="quantity-input" className="block text-sm font-medium text-gray-700 mb-1">Qty<sup className="text-red-500">*</sup></Label>
                    <Input
                        id="quantity-input"
                        type="number"
                        placeholder='0.00'
                        value={curQuantity}
                        onChange={(e) => setCurQuantity(e.target.value)}
                        disabled={disabled || !curItem}
                        min="0"
                        step="any"
                    />
                </div>

                {/* Unit Display (Quarter Width) */}
                <div className="w-full sm:w-1/4">
                    <Label className="block text-sm font-medium text-gray-700 mb-1">Unit</Label>
                    <Input type="text" disabled value={curItem?.unit || '--'} className="bg-gray-100 cursor-not-allowed" />
                </div>
            </div>

            {/* --- Comment Input (Full Width) --- */}
            <div>
                <Label htmlFor="comment-input" className="block text-sm font-medium text-gray-700 mb-1">Comment (Optional)</Label>
                <Input
                    id="comment-input"
                    type="text"
                    placeholder='Add notes for this item...'
                    value={curComment}
                    onChange={(e) => setCurComment(e.target.value)}
                    disabled={disabled || !curItem}
                />
            </div>

            {/* --- Add Item Button (Full Width) --- */}
            <Button
                onClick={handleAddItemClick}
                disabled={disabled || !curItem || !curQuantity || parseFloat(curQuantity) <= 0}
                variant={"outline"}
                className="w-full border border-primary text-primary hover:bg-primary/5"
            >
                Add Item to List
            </Button>

            {/* --- Manage Makes Dialog Instance --- */}
            {currentItemCategoryName && (
                <ManageCategoryMakesDialog
                    isOpen={isManageMakesDialogOpen}
                    onOpenChange={setIsManageMakesDialogOpen}
                    categoryName={currentItemCategoryName}
                    associatedMakes={
                        (selectedCategories.find(c => c.name === currentItemCategoryName)?.makes) ?? // Check derived state first
                        (initialCategoryMakes[currentItemCategoryName]) ?? // Fallback to initial state
                        [] // Default to empty array
                    }
                    allMakeOptions={allMakeOptions}
                    onMakesAssociated={handleMakesManaged}
                    makeList={makeList} // Pass makeList down
                    makeListMutate={makeListMutate}
                    categoryMakeListMutate={categoryMakeListMutate}
                />
            )}
        </div>
    );
};
