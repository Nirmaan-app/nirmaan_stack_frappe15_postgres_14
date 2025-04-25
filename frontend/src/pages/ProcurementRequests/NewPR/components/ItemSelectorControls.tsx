// src/features/procurement-requests/components/ItemSelectorControls.tsx
import React, { useState, useEffect, useMemo } from 'react';
import ReactSelect, { components, MenuListProps, OptionProps, SingleValue } from 'react-select';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogClose } from "@/components/ui/dialog"; // Adjust path
import { Pencil, CirclePlus } from "lucide-react";
import { CategoryOption, ItemOption, ProcurementRequestItem } from '../types'; // Adjust path
import { useUserData } from '@/hooks/useUserData'; // Adjust path
import { Category } from '@/types/NirmaanStack/Category';
import { parseNumber } from '@/utils/parseNumber';

// Custom MenuList for ReactSelect to add "Create/Request" button
const CustomMenuList = (props: MenuListProps<ItemOption | CategoryOption, false>) => {
    const {
        children,
        selectProps: { 
            onAddItemClick
         } // Access custom props passed via selectProps
    } = props;

    // const { onAddItemClick, onOpenNewItemDialog, isNewItemsDisabled } = customProps || {};

    console.log("onAddItemClick", onAddItemClick)
    // console.log("customProps", customProps)

    // console.log("isNewItemsDisabled", isNewItemsDisabled)

    // console.log("isNewItemsDisabled", isNewItemsDisabled)

    return (
        <div>
            <components.MenuList {...props}>
                <div>{children}</div>
            </components.MenuList>
            {/* Sticky Button Area */}
            <div className="sticky bottom-0 z-10 bg-white border-t border-gray-200 px-2 py-1">
                <Button
                    variant="ghost"
                    className="w-full rounded-md flex items-center justify-center gap-1 text-sm h-9 text-blue-600 hover:bg-blue-50"
                    onClick={onAddItemClick}
                    // onTouchStart={onOpenNewItemDialog} // Use onClick, React handles touch events
                >
                    <CirclePlus className="w-4 h-4" />
                    Create/Request New Item
                </Button>
                {/* {isNewItemsDisabled && (
                     <p className="text-xs text-center text-red-500 mt-1 px-1">
                       Creation disabled for this category. Request only.
                     </p>
                )} */}
            </div>
        </div>
    );
};


interface ItemSelectorControlsProps {
    selectedWP: string;
    catOptions: CategoryOption[];
    itemOptions: ItemOption[];
    onAddItem: (itemData: Omit<ProcurementRequestItem, 'uniqueId' | 'status'>, isRequest?: boolean) => void; // Simplified callback
    onOpenNewItemDialog: () => void;
    allowWpEdit: boolean;
    onEditWP: () => void;
    disabled?: boolean; // To disable during submission
    categoryList?: Category[]; // Pass full category list for checks
}

export const ItemSelectorControls: React.FC<ItemSelectorControlsProps> = ({
    selectedWP,
    catOptions,
    itemOptions,
    onAddItem,
    onOpenNewItemDialog,
    allowWpEdit,
    onEditWP,
    disabled = false,
    categoryList,
}) => {
    const [curCategory, setCurCategory] = useState<SingleValue<CategoryOption>>(null);
    const [curItem, setCurItem] = useState<SingleValue<ItemOption>>(null);
    const [curQuantity, setCurQuantity] = useState<string>('');
    const [curComment, setCurComment] = useState<string>('');
    const userData = useUserData(); // Get user data for role check

    // Filter item options based on selected category
    // const filteredItemOptions = useMemo(() => {
    //     if (!curCategory) return [];
    //     return itemOptions.filter(item => item.category === curCategory.value);
    // }, [curCategory, itemOptions]);

     // Check if new item creation is disabled for the selected category
     const isNewItemsDisabled = useMemo(() => {
        if (!curCategory || !categoryList) return false;
        const categoryDetails = categoryList.find(c => c.name === curCategory.value);
        // Disable if 'new_items' is explicitly "false" AND user is not an Admin
        return categoryDetails?.new_items === "false" && userData?.role !== "Nirmaan Admin Profile";
    }, [curCategory, categoryList, userData?.role]);


    const handleAddItemClick = () => {
        if (!curItem || !curQuantity || parseNumber(curQuantity) <= 0) {
            // Basic validation feedback (consider using react-hook-form for complex forms)
            alert("Please select an item, category, and enter a valid quantity.");
            return;
        }

        onAddItem({
            name: curItem.value, // Use the selected item's DocName
            item: curItem.label,
            unit: curItem.unit,
            quantity: parseFloat(curQuantity),
            category: curItem.category,
            tax: curItem.tax,
            // category: curCategory.value,
            // tax: curCategory.tax,
            comment: curComment.trim() || undefined, // Add comment if present
            // status: "Pending", // Status will be set in the hook/store logic
            // Status will be set in the hook/store logic ('Pending')
        });

        // Reset local form state
        setCurItem(null);
        // Keep category selected? Optional: setCurCategory(null);
        setCurQuantity('');
        setCurComment('');
    };

    // Reset item when category changes
    // useEffect(() => {
    //     setCurItem(null);
    //     setCurQuantity('');
    //     setCurComment('');
    // }, [curCategory]);

    // Custom props to pass to ReactSelect's CustomMenuList
     const selectCustomProps = {
        onOpenNewItemDialog,
        isNewItemsDisabled,
    };

    return (
        <div className='space-y-4'>
            {/* Work Package Display */}
            <div className="flex items-center justify-between">
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

             {/* Category Selector (Hidden on mobile in original, let's keep it visible) */}
             {/* <div className="w-full">
                 <label className="block text-sm font-medium text-gray-400 mb-1">Category <sup className="text-red-500">*</sup></label>
                 <ReactSelect
                    placeholder="Select Category..."
                    isDisabled={disabled || catOptions.length === 0}
                    value={curCategory}
                    options={catOptions}
                    onChange={(selectedOption) => setCurCategory(selectedOption)}
                    isClearable
                 />
             </div> */}


            {/* Item Selector */}
             <label className="block text-sm font-medium text-gray-400 mb-1">Item <sup className="text-red-500">*</sup></label>
            <ReactSelect
                placeholder={"Select or Create Item..."}
                value={curItem}
                isDisabled={disabled}
                // isDisabled={disabled || !curCategory}
                options={itemOptions}
                onChange={(selectedOption) => setCurItem(selectedOption)}
                components={{ MenuList: CustomMenuList }}
                onAddItemClick={onOpenNewItemDialog}
                selectProps={{ customProps: selectCustomProps }} // Pass custom props here
                isClearable
                // onMenuOpen={() => setCurItem(null)} // Resetting on open might be annoying UX
            />

            {/* Quantity, Unit, Comment Inputs */}
            <div className="flex items-end gap-4">
                <div className="w-1/2">
                    <label className="block text-sm font-medium text-gray-400 mb-1">Comment (Optional)</label>
                    <Input
                        type="text"
                        placeholder='Add notes...'
                        value={curComment}
                        onChange={(e) => setCurComment(e.target.value)}
                        disabled={disabled || !curItem}
                    />
                </div>
                <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-400 mb-1">Qty<sup className="text-red-500">*</sup></label>
                    <Input
                        type="number"
                        placeholder='0.00'
                        value={curQuantity}
                        onChange={(e) => setCurQuantity(e.target.value)}
                        disabled={disabled || !curItem}
                        min="0" // Basic validation
                        step="any" // Allow decimals
                    />
                </div>
                 <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-400 mb-1">Unit</label>
                    <Input type="text" disabled value={curItem?.unit || '--'} className="bg-gray-100" />
                </div>
            </div>

            {/* Add Item Button */}
            <Button
                onClick={handleAddItemClick}
                disabled={disabled || !curItem || !curQuantity || parseFloat(curQuantity) <= 0}
                variant={"outline"}
                className="w-full border border-primary text-primary hover:bg-primary/5"
            >
                Add Item to List
            </Button>
        </div>
    );
};