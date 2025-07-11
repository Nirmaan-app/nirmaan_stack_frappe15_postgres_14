// src/features/procurement-requests/components/EditItemDialog.tsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import ReactSelect, { SingleValue } from 'react-select'; // Import ReactSelect and SingleValue

import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogFooter,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectUnit } from '@/components/helpers/SelectUnit';
import { useToast } from "@/components/ui/use-toast";
import { ListChecks, Trash2 } from "lucide-react"; // Import icons
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// Import Make related types and components
import {
    ProcurementRequestItem,
    CategoryOption,
    MakeOption,
    CategorySelection,
    CategoryMakesMap
} from '../types';
import { ManageCategoryMakesDialog } from './ManageCategoryMakesDialog'; // Import the makes dialog
import { CustomMakeMenuList } from './ItemSelectorControls'; // Reuse CustomMakeMenuList if suitable
import { ItemStatus } from '../constants';
import { Category } from '@/types/NirmaanStack/Category';
import { Makelist } from '@/types/NirmaanStack/Makelist';
import { CategoryMakelist } from '@/types/NirmaanStack/CategoryMakelist';
import { useProcurementRequestStore } from '../store/useProcurementRequestStore';


interface EditItemDialogProps {
    isOpen: boolean;
    onOpenChange: (isOpen: boolean) => void;
    itemToEdit: ProcurementRequestItem | null;
    categories: Category[];
    onSubmitUpdate: (updatedItem: ProcurementRequestItem) => void;
    onDeleteItem: (itemName: string) => void;
    // --- Make Props ---
    allMakeOptions: MakeOption[];
    initialCategoryMakes: CategoryMakesMap;
    selectedCategories: CategorySelection[]; // Current derived categories from store
    updateCategoryMakesInStore: (categoryName: string, newMake: string) => void;
    makeList?: Makelist[];
    makeListMutate: () => Promise<any>;
    categoryMakelist?: CategoryMakelist[]; // Optional, if needed for other operations
    categoryMakeListMutate?: () => Promise<any>;
    // --- End Make Props ---
}

// Extended edit state to include make
interface EditState {
    quantity: string;
    comment: string;
    category?: string;
    itemName?: string;
    unitName?: string;
    makeValue?: string; // Store the make *value* (DocType name)
}

export const EditItemDialog: React.FC<EditItemDialogProps> = ({
    isOpen,
    onOpenChange,
    itemToEdit,
    categories = [],
    onSubmitUpdate,
    onDeleteItem,
    // Make Props Destructuring
    allMakeOptions,
    initialCategoryMakes,
    selectedCategories,
    updateCategoryMakesInStore,
    makeList,
    makeListMutate,
    categoryMakelist,
    categoryMakeListMutate,
}) => {
    const { toast } = useToast();
    const [editState, setEditState] = useState<EditState | null>(null);
    // State for Manage Makes Dialog specific to this Edit Dialog instance
    const [isManageMakesDialogOpen, setIsManageMakesDialogOpen] = useState(false);

    const isRequestItem = itemToEdit?.status === ItemStatus.REQUEST;

    // --- Memos ---
    const catOptions: CategoryOption[] = useMemo(() => {
        return categories.map(cat => ({
            value: cat.name, label: cat.category_name,
            tax: parseFloat(cat.tax || "0"), newItemsDisabled: false,
        }));
    }, [categories]);

    // Get current item's category name (from editState if request, else from itemToEdit)
    const currentItemCategoryName = isRequestItem ? editState?.category : itemToEdit?.category;

    // Calculate available make options for the Make select dropdown
    // const availableMakeOptions = useMemo(() => {
    //     if (!currentItemCategoryName) return [];
    //     let makesForCategory: string[] = [];
    //     const derivedCategoryDetails = selectedCategories.find(c => c.name === currentItemCategoryName);

    //     if (derivedCategoryDetails && Array.isArray(derivedCategoryDetails.makes)) {
    //         makesForCategory = derivedCategoryDetails.makes;
    //     } else if (initialCategoryMakes && initialCategoryMakes[currentItemCategoryName]) {
    //         makesForCategory = initialCategoryMakes[currentItemCategoryName];
    //     }
    //     const makesSet = new Set(Array.isArray(makesForCategory) ? makesForCategory : []);
    //     return allMakeOptions.filter(opt => makesSet.has(opt.value));
    // }, [currentItemCategoryName, selectedCategories, initialCategoryMakes, allMakeOptions]);

    // --- *** FINAL REVISED LOGIC for availableMakeOptions *** ---
    const availableMakeOptions = useMemo(() => {
        // --- Logging Start ---
        console.log("--- ISC useMemo Start ---");
        console.log("currentItemCategoryName:", currentItemCategoryName);
        console.log("selectedCategories (prop):", JSON.stringify(selectedCategories));
        console.log("initialCategoryMakes (prop):", JSON.stringify(initialCategoryMakes));
        // --- Logging End ---

        if (!currentItemCategoryName) {
            console.log("ISC useMemo: No category, returning []");
            return [];
        }

        // Use a Set to automatically handle unique make names (values)
        const applicableMakeValues = new Set<string>();

        // 1. Determine the BASE list (Initial Config OR Fallback)
        const initialMakes = initialCategoryMakes?.[currentItemCategoryName];
        const hasInitialMakes = Array.isArray(initialMakes) && initialMakes.length > 0;

        if (hasInitialMakes) {
            // Use initial makes from the WP Project config as the base
            console.log(`ISC useMemo: Using initialMakes as base:`, initialMakes);
            initialMakes!.forEach(makeValue => applicableMakeValues.add(makeValue));
        } else if (categoryMakelist) {
            // Fallback to CategoryMakelist if initial makes are empty/not defined
            console.log(`ISC useMemo: Initial makes empty, using CategoryMakelist fallback as base.`);
            categoryMakelist
                .filter(entry => entry.category === currentItemCategoryName && entry.make)
                .forEach(entry => applicableMakeValues.add(entry.make!)); // Add makes from fallback
        } else {
            console.log(`ISC useMemo: No initial makes and no categoryMakelist provided for base.`);
        }
        console.log(`ISC useMemo: Makes after base determination:`, Array.from(applicableMakeValues));


        // 2. ADD makes from Session/procList (selectedCategories)
        // Ensure makes used in items or explicitly added this session (via Manage Makes)
        // are *always* included in the available options.
        // const derivedCategoryDetails = selectedCategories.find(c => c.name === currentItemCategoryName);
        // if (derivedCategoryDetails?.makes && Array.isArray(derivedCategoryDetails.makes)) {
        //     console.log(`ISC useMemo: Adding makes from selectedCategories:`, derivedCategoryDetails.makes);
        //     derivedCategoryDetails.makes.forEach(makeValue => applicableMakeValues.add(makeValue));
        // } else {
        //     console.log(`ISC useMemo: No additional makes found in selectedCategories.`);
        // }

        console.log(`ISC useMemo: Final applicable make values set:`, Array.from(applicableMakeValues));

        // 3. Filter allMakeOptions based on the final applicable set of make values
        let potentialMakeOptions = allMakeOptions.filter(opt => applicableMakeValues.has(opt.value));

        // 4. Sort the final list alphabetically by label for consistent display
        potentialMakeOptions.sort((a, b) => a.label.localeCompare(b.label));

        console.log("ISC useMemo: Final potentialMakeOptions (before return):", JSON.stringify(potentialMakeOptions));
        console.log("--- ISC useMemo End ---");
        return potentialMakeOptions;

    }, [
        currentItemCategoryName,
        selectedCategories,      // Derived makes from store (items + session adds)
        initialCategoryMakes,    // Baseline makes from project WP config
        allMakeOptions,          // The complete list of make options
        categoryMakelist         // Fallback list if initial is empty
    ]);
    // --- End FINAL REVISED LOGIC ---

    // Get the currently selected MakeOption object based on editState.makeValue
    const currentMakeOption = useMemo(() => {
        if (!editState?.makeValue) return null;
        // Search within the available options first, then all options as a fallback
        return availableMakeOptions.find(opt => opt.value === editState.makeValue) ||
            allMakeOptions.find(opt => opt.value === editState.makeValue) ||
            null;
    }, [editState?.makeValue, availableMakeOptions, allMakeOptions]);


    // --- Effects ---
    // Initialize edit state when itemToEdit changes or dialog opens
    useEffect(() => {
        if (itemToEdit && isOpen) {
            setEditState({
                quantity: String(itemToEdit.quantity || ''),
                comment: itemToEdit.comment || '',
                category: isRequestItem ? itemToEdit.category : undefined,
                itemName: isRequestItem ? itemToEdit.item : undefined,
                unitName: isRequestItem ? itemToEdit.unit : undefined,
                makeValue: itemToEdit.make || undefined, // Initialize make value
            });
        } else if (!isOpen) {
            setEditState(null); // Reset state when closing
            setIsManageMakesDialogOpen(false); // Close manage makes dialog too
        }
    }, [itemToEdit, isOpen, isRequestItem]);


    // --- Handlers ---
    const handleInputChange = (field: keyof EditState, value: string) => {
        setEditState(prev => prev ? { ...prev, [field]: value } : null);
    };

    const handleCategoryChange = (value: string) => {
        // Reset make if category changes for a request item? Optional.
        setEditState(prev => prev ? { ...prev, category: value, makeValue: undefined } : null);
    };

    const handleUnitChange = (value: string) => {
        handleInputChange('unitName', value);
    };

    // Handler for Make select change
    const handleMakeChange = (selectedOption: SingleValue<MakeOption>) => {
        setEditState(prev => prev ? { ...prev, makeValue: selectedOption?.value || undefined } : null);
    };

    const closeDialog = useCallback(() => {
        onOpenChange(false);
    }, [onOpenChange]);

    const handleUpdateConfirm = () => {
        if (!itemToEdit || !editState) return;
        const currentSelectedWP = useProcurementRequestStore.getState().selectedWP;

        // ... (existing validation for quantity, category, item name, unit) ...
        const quantity = parseFloat(editState.quantity);
        if (isNaN(quantity) || quantity <= 0) {
            toast({ title: "Invalid Quantity", variant: "destructive" }); return;
        }
        if (isRequestItem && (!editState.category || !editState.itemName || !editState.unitName)) {
            toast({ title: "Missing Information", variant: "destructive" }); return;
        }

        const updatedItemData: ProcurementRequestItem = {
            ...itemToEdit,
            quantity: quantity,
            comment: editState.comment.trim() || undefined,
            make: editState.makeValue || undefined, // <<< Add the selected make
            work_package: itemToEdit.work_package || currentSelectedWP,
            ...(isRequestItem && {
                category: editState.category!,
                item: editState.itemName!.trim(),
                unit: editState.unitName!,
                tax: catOptions.find(c => c.value === editState.category)?.tax ?? itemToEdit.tax,
                work_package: currentSelectedWP,
            }),
        };

        onSubmitUpdate(updatedItemData);
        closeDialog();
    };

    const handleDeleteConfirm = () => {
        // ... (existing delete logic) ...
        if (!itemToEdit) return;
        onDeleteItem(itemToEdit.uniqueId || itemToEdit.name); // Use uniqueId first
        closeDialog();
    };

    // Handler for opening the Manage Makes dialog
    const handleOpenManageMakesDialog = useCallback(() => {
        if (!currentItemCategoryName) {
            toast({ title: "Cannot Manage Makes", description: "Item category is not defined.", variant: "destructive" });
            return;
        }
        setIsManageMakesDialogOpen(true);
    }, [currentItemCategoryName, toast]);

    // Handler for when makes are managed (associated/created) in the sub-dialog
    const handleMakesManaged = useCallback((newlyAssociatedMakes: MakeOption[]) => {
        if (!currentItemCategoryName) return;
        let makeToSelectAfterwards: MakeOption | null = null;

        newlyAssociatedMakes.forEach(make => {
            updateCategoryMakesInStore(currentItemCategoryName, make.value);
            // Keep track of the first newly added make to potentially auto-select it
            if (!makeToSelectAfterwards) {
                makeToSelectAfterwards = make;
            }
        });

        setIsManageMakesDialogOpen(false);

        // Auto-select the first newly added/associated make
        if (makeToSelectAfterwards) {
            // Need the full option object, find it in allMakeOptions
            const fullOption = allMakeOptions.find(opt => opt.value === makeToSelectAfterwards!.value);
            if (fullOption) {
                handleMakeChange(fullOption); // Use the state update handler
            }
        }
    }, [currentItemCategoryName, updateCategoryMakesInStore, allMakeOptions, handleMakeChange]); // Add handleMakeChange dependency

    // Custom props for the Make ReactSelect
    const makeSelectCustomProps = {
        onManageMakesClick: handleOpenManageMakesDialog,
    };

    // --- Render ---
    if (!itemToEdit || !editState) {
        return null;
    }

    const labelClass = "text-sm font-medium text-gray-700 text-right";

    return (
        <> {/* Use Fragment to wrap main dialog and sub-dialog */}
            <AlertDialog open={isOpen} onOpenChange={onOpenChange}>
                <AlertDialogContent className="sm:max-w-[600px]">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="flex justify-between items-center">
                            <span>Edit {isRequestItem ? 'Requested' : ''} Item</span>
                            <AlertDialogCancel className="border-none shadow-none p-0 h-6 w-6 relative -top-2 -right-2">
                                X
                            </AlertDialogCancel>
                        </AlertDialogTitle>
                        <AlertDialogDescription className="pt-1">
                            Modify the details below or delete the item from the list.
                        </AlertDialogDescription>
                    </AlertDialogHeader>

                    <div className="space-y-4 py-3">
                        {/* Row 1: Item Name */}
                        <div className="grid grid-cols-4 gap-x-4 items-center">
                            <Label htmlFor='editItemNameDisplay' className={labelClass}>Item Name</Label>
                            <div className="col-span-3">
                                {/* ... (Item Name Input/Display) ... */}
                                {isRequestItem ? (<Input id='editItemNameDisplay' value={editState.itemName ?? ''} onChange={(e) => handleInputChange('itemName', e.target.value)} placeholder="Enter Item Name" />
                                ) : (<p className="font-medium text-gray-800 py-2">{itemToEdit.item}</p>)}
                            </div>
                        </div>

                        {/* Row 2: Category (Conditional) */}
                        {isRequestItem && (
                            <div className="grid grid-cols-4 gap-x-4 items-center">
                                <Label className={labelClass}>Category</Label>
                                <div className="col-span-3">
                                    <Select value={editState.category ?? ''} onValueChange={handleCategoryChange}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select Category..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {catOptions.map((cat) => (
                                                <SelectItem key={cat.value} value={cat.value}>
                                                    {cat.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        )}

                        {/* --- Row X: Make Selector --- */}
                        <div className="grid grid-cols-4 gap-x-4 items-center">
                            <Label htmlFor='editMake' className={labelClass}>Make</Label>
                            <div className="col-span-3">
                                <ReactSelect
                                    inputId='editMake'
                                    placeholder="Select or Add Make..."
                                    value={currentMakeOption} // Use the derived option object
                                    isDisabled={!currentItemCategoryName} // Disable if no category
                                    options={availableMakeOptions}
                                    onChange={handleMakeChange} // Use specific handler
                                    onManageMakesClick={handleOpenManageMakesDialog}
                                    components={{ MenuList: CustomMakeMenuList }} // Reuse menu if desired
                                    selectProps={{ customProps: makeSelectCustomProps }} // Pass dialog opener
                                    isClearable
                                />
                            </div>
                        </div>
                        {/* --- End Make Selector --- */}

                        {/* Row 3: Unit & Quantity */}
                        <div className="grid grid-cols-4 gap-x-4 items-start">
                            <div className={labelClass}>Unit / Qty *</div>
                            <div className="col-span-3 grid grid-cols-2 gap-4">
                                {/* Unit */}
                                <div className='space-y-1'>
                                    {/* ... (Unit Select/Display) ... */}
                                    <Label htmlFor="editUnit" className='text-xs text-gray-500 pl-1'>Unit</Label>
                                    {isRequestItem ? (<SelectUnit value={editState.unitName ?? ''} onChange={handleUnitChange} />
                                    ) : (<p className="font-medium text-gray-800 h-9 flex items-center px-1">{itemToEdit.unit}</p>)}
                                </div>
                                {/* Quantity */}
                                <div className='space-y-1'>
                                    <Label htmlFor="editQuantity" className='text-xs text-gray-500 pl-1'>Quantity <sup className='text-red-500'>*</sup></Label>
                                    <Input id="editQuantity" type="number" inputMode='decimal' min="0" step="any" value={editState.quantity} onChange={(e) => handleInputChange('quantity', e.target.value)} placeholder="0.00" className="h-9" />
                                </div>
                            </div>
                        </div>

                        {/* Row 4: Comment */}
                        <div className="grid grid-cols-4 gap-x-4 items-start">
                            <Label htmlFor="editComment" className={`${labelClass} pt-2`}>Comment</Label>
                            <div className="col-span-3">
                                {/* ... (Comment Textarea) ... */}
                                <textarea id="editComment" className="block p-2 border-gray-300 border rounded-md w-full min-h-[70px] text-sm focus:ring-1 focus:ring-primary focus:border-primary" placeholder="Add comment (optional)..." value={editState.comment} onChange={(e) => handleInputChange('comment', e.target.value)} />
                            </div>
                        </div>
                    </div>

                    <AlertDialogFooter className="flex flex-row justify-between items-center sm:justify-between pt-4 mt-2 border-t">
                        {/* ... (Delete and Update Buttons) ... */}
                        <Button variant="outline" onClick={handleDeleteConfirm} className='text-red-600 border-red-300 hover:bg-red-50'> <Trash2 className="h-4 w-4 mr-1.5" /> Delete Item </Button>
                        <div className="flex gap-3">
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <Button onClick={handleUpdateConfirm}> <ListChecks className="h-4 w-4 mr-1.5" /> Update Item </Button>
                        </div>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* --- Manage Makes Dialog Instance (Rendered conditionally but outside main dialog) --- */}
            {currentItemCategoryName && (
                <ManageCategoryMakesDialog
                    isOpen={isManageMakesDialogOpen}
                    onOpenChange={setIsManageMakesDialogOpen}
                    categoryName={currentItemCategoryName}
                    // Pass makes based on the item being edited
                    associatedMakes={
                        (selectedCategories.find(c => c.name === currentItemCategoryName)?.makes) ??
                        (initialCategoryMakes[currentItemCategoryName]) ??
                        []
                    }
                    allMakeOptions={allMakeOptions}
                    onMakesAssociated={handleMakesManaged}
                    makeList={makeList}
                    makeListMutate={makeListMutate}
                    categoryMakeListMutate={categoryMakeListMutate}
                />
            )}
            {/* --- End Manage Makes Dialog --- */}
        </>
    );
};