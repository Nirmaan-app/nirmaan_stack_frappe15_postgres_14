import React, { useState, useMemo, useCallback, useEffect } from 'react'; // Added useState, useMemo, useCallback, useEffect
import ReactSelect, { SingleValue } from 'react-select'; // Added SingleValue
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label'; // Added Label
import { CirclePlus, X } from 'lucide-react';
import { ItemOption, PRCategory } from '../types'; // Added PRCategory
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { parseNumber } from '@/utils/parseNumber';
import { MakeOption, CategoryMakesMap } from '../../NewPR/types'; // Added Make types
import { Makelist } from '@/types/NirmaanStack/Makelist'; // Added Makelist type
import { CategoryMakelist } from '@/types/NirmaanStack/CategoryMakelist'; // Import CategoryMakelist
import { ManageCategoryMakesDialog } from '../../NewPR/components/ManageCategoryMakesDialog'; // Added Manage Makes Dialog
import { CustomMakeMenuList } from '../../NewPR/components/ItemSelectorControls'; // Added Custom Menu List


interface AddItemFormProps {
    itemOptions: ItemOption[];
    currentItemOption: ItemOption | null;
    setCurrentItemOption: (option: ItemOption | null) => void;
    quantity: string;
    handleQuantityChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    // Modified onAdd to accept make
    onAdd: (selectedMake?: string) => void;
    onClose: () => void;
    onToggleNewItemDialog: () => void;
    canCreateItem: boolean;
    isLoading: boolean;
    showNewItemsCard: boolean;

    // --- Make Props (NEW) ---
    allMakeOptions: MakeOption[];
    initialCategoryMakes: CategoryMakesMap; // Baseline makes for the WP
    orderDataCategoryList: PRCategory[]; // Current derived categories from orderData state in hook
    updateCategoryMakesInStore: (categoryName: string, newMake: string) => void; // Function to update local state in hook
    makeList?: Makelist[];
    makeListMutate: () => Promise<any>;
    categoryMakelist?: CategoryMakelist[]; // <<< Add prop
    categoryMakeListMutate?: () => Promise<any>;
    // --- End Make Props ---
}


export const AddItemForm: React.FC<AddItemFormProps> = ({
    itemOptions,
    currentItemOption,
    setCurrentItemOption,
    quantity,
    handleQuantityChange,
    onAdd,
    onClose,
    onToggleNewItemDialog,
    canCreateItem,
    isLoading,
    showNewItemsCard,
    // Make Props
    allMakeOptions,
    initialCategoryMakes,
    orderDataCategoryList, // Use this prop
    updateCategoryMakesInStore,
    makeList,
    makeListMutate,
    categoryMakelist, // <<< Destructure
    categoryMakeListMutate,
}) => {
    // --- State for Makes ---
    const [currentMakeOption, setCurrentMakeOption] = useState<MakeOption | null>(null);
    const [isManageMakesDialogOpen, setIsManageMakesDialogOpen] = useState(false);
    // --- End State for Makes ---

    // --- Memos for Makes ---
    const currentItemCategoryName = currentItemOption?.category;

    const availableMakeOptions = useMemo(() => {
        if (!currentItemCategoryName) return [];
        let makesForCategory: string[] = [];
        const derivedCategoryDetails = orderDataCategoryList.find(c => c.name === currentItemCategoryName);
        if (derivedCategoryDetails?.makes) {
            makesForCategory = derivedCategoryDetails.makes;
        } else if (initialCategoryMakes?.[currentItemCategoryName]) {
            makesForCategory = initialCategoryMakes[currentItemCategoryName];
        }
        const makesSet = new Set(Array.isArray(makesForCategory) ? makesForCategory : []);
        return allMakeOptions.filter(opt => makesSet.has(opt.value));
    }, [currentItemCategoryName, orderDataCategoryList, initialCategoryMakes, allMakeOptions]);

    // --- Effect to reset make when item changes ---
    useEffect(() => {
        // Reset make selection if the main item selection changes or is cleared
        setCurrentMakeOption(null);
    }, [currentItemOption]);
    // --- End Effect ---

    // --- Handlers for Makes ---
    const handleMakeChange = (selectedOption: SingleValue<MakeOption>) => {
        setCurrentMakeOption(selectedOption);
    };

    const handleOpenManageMakesDialog = useCallback(() => {
        if (!currentItemCategoryName) {
            console.error("Cannot manage makes, item category not found.");
            // Optionally show a toast notification
            return;
        }
        setIsManageMakesDialogOpen(true);
    }, [currentItemCategoryName]);

    // *** MODIFIED handleMakesManaged ***
    const handleMakesManaged = useCallback((newlyAssociatedMakes: MakeOption[]) => {
        if (!currentItemCategoryName || newlyAssociatedMakes.length === 0) {
            setIsManageMakesDialogOpen(false); // Close dialog even if error/empty
            return;
        }
        const makeToSelect = newlyAssociatedMakes[0]; // Get the single make passed back

        // 1. Update central store state via hook prop
        updateCategoryMakesInStore(currentItemCategoryName, makeToSelect.value);

        // 2. Close the dialog
        setIsManageMakesDialogOpen(false);

        // 3. Set the current make selection directly in this component's state
        setCurrentMakeOption(makeToSelect);

    }, [currentItemCategoryName, updateCategoryMakesInStore, setCurrentMakeOption]); // Added setCurrentMakeOption dependency

    // Custom props for the Make ReactSelect
    const makeSelectCustomProps = {
        onManageMakesClick: handleOpenManageMakesDialog,
    };
    // --- End Handlers for Makes ---

    // --- Modified Add Handler ---
    const handleAddClick = () => {
        onAdd(currentMakeOption?.value); // Pass the selected make's value (or undefined)
        // Reset make state after adding
        setCurrentMakeOption(null);
    };
    // --- End Modified Add Handler ---

    // --- *** REVISED Close Handler - Only resets local state *** ---
    // This function will be called by onOpenChange when closing
    const cleanupOnClose = useCallback(() => {
        setCurrentMakeOption(null); // Reset local make state
        // DO NOT call onClose() here - onOpenChange will trigger the parent's onClose
    }, [setCurrentMakeOption]);


    // --- *** REVISED onOpenChange Handler *** ---
    // This connects the dialog's internal state changes to the parent's state control
    const handleOpenChange = (isOpen: boolean) => {
        if (!isOpen) {
            // Perform cleanup when the dialog is about to close
            cleanupOnClose();
            // Call the actual onClose prop passed from the parent,
            // which is responsible for setting showNewItemsCard to false
            onClose();
        }
        // If opening (isOpen is true), we don't need to do anything extra here,
        // as the open state is controlled by the showNewItemsCard prop.
    };
    return (
        <>
            <AlertDialog open={showNewItemsCard} onOpenChange={handleOpenChange}>
                <AlertDialogContent className="sm:max-w-[750px]"> {/* Wider content for more fields */}
                    <AlertDialogHeader>
                        <AlertDialogTitle className="flex justify-between items-center">
                            <span>Add Missing Product</span>
                            {/* Use standard AlertDialogCancel for consistent closing */}
                            <AlertDialogCancel
                                className="border-none shadow-none p-0 h-6 w-6 relative -top-2 -right-2"
                            >
                                X
                            </AlertDialogCancel>
                        </AlertDialogTitle>

                        <div className="flex flex-col space-y-3 pt-4"> {/* Changed layout slightly */}
                            {/* Row 1: Product Selection */}
                            <div className="w-full">
                                <Label className="text-xs text-muted-foreground db-block mb-1">Select Product <span className='text-red-500'>*</span></Label>
                                <ReactSelect
                                    value={currentItemOption}
                                    options={itemOptions}
                                    onChange={(selected) => setCurrentItemOption(selected as ItemOption)}
                                    isClearable
                                    placeholder="Search or select a product..."
                                    isDisabled={isLoading}
                                    classNamePrefix="react-select" // Optional: for styling
                                />
                            </div>

                            {/* Row 2: Make, UOM, Quantity */}
                            <div className="flex flex-col md:flex-row md:space-x-2 space-y-3 md:space-y-0">
                                {/* Make Selector */}
                                <div className="flex-grow md:w-1/3">
                                    <Label htmlFor='add-item-make-select' className="text-xs text-muted-foreground db-block mb-1">Make</Label>
                                    <ReactSelect
                                        inputId='add-item-make-select'
                                        placeholder="Select Make..."
                                        value={currentMakeOption}
                                        isDisabled={isLoading || !currentItemOption} // Disable if no item selected
                                        options={availableMakeOptions}
                                        onChange={handleMakeChange}
                                        // // Pass custom props/handlers for "Manage Makes"
                                        onManageMakesClick={handleOpenManageMakesDialog} // Prop expected by CustomMakeMenuList
                                        components={{ MenuList: CustomMakeMenuList }} // Use custom menu list
                                        selectProps={{ customProps: makeSelectCustomProps }} // Pass custom data via selectProps
                                        isClearable
                                        classNamePrefix="react-select"
                                    />
                                </div>

                                {/* UOM (Read Only) */}
                                <div className="flex-shrink w-full md:w-[100px]">
                                    <Label className="text-xs text-muted-foreground db-block mb-1">UOM</Label>
                                    <Input
                                        type="text"
                                        placeholder="Unit"
                                        value={currentItemOption?.unit || ''}
                                        readOnly
                                        className="bg-gray-100 cursor-not-allowed h-9" // Match ReactSelect height
                                    />
                                </div>

                                {/* Quantity */}
                                <div className="flex-shrink w-full md:w-[100px]">
                                    <Label className="text-xs text-muted-foreground db-block mb-1">Quantity <span className='text-red-500'>*</span></Label>
                                    <Input
                                        type="number"
                                        placeholder="Qty"
                                        value={quantity}
                                        onChange={handleQuantityChange}
                                        min="0.01"
                                        step="any"
                                        disabled={isLoading || !currentItemOption}
                                        className="h-9" // Match ReactSelect height
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="flex justify-between items-center mt-4 pt-4 border-t">
                            {/* Create New Product Button */}
                            {canCreateItem ? (<Button variant="link" className="text-sm p-0 h-auto text-blue-600 hover:text-blue-800" onClick={onToggleNewItemDialog} disabled={isLoading}> <CirclePlus className="w-4 h-4 mr-1" /> Create New Product </Button>) : <div />}
                            {/* Cancel/Add Buttons */}
                            <div className='flex items-center gap-2'>
                                {/* --- *** REMOVE onClick from footer AlertDialogCancel *** --- */}
                                {/* It will trigger onOpenChange automatically */}
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <Button onClick={handleAddClick} disabled={!currentItemOption || !quantity || parseNumber(quantity) <= 0 || isLoading} size="sm"> {isLoading ? "Adding..." : "Add Product"} </Button>
                            </div>
                        </div>
                    </AlertDialogHeader>
                </AlertDialogContent>
            </AlertDialog>

            {/* --- Manage Makes Dialog Instance --- */}
            {currentItemCategoryName && ( // Only render if a category is selected
                <ManageCategoryMakesDialog
                    isOpen={isManageMakesDialogOpen}
                    onOpenChange={setIsManageMakesDialogOpen}
                    categoryName={currentItemCategoryName}
                    // Determine associated makes based on current derived state THEN baseline
                    associatedMakes={
                        (orderDataCategoryList.find(c => c.name === currentItemCategoryName)?.makes) ??
                        (initialCategoryMakes[currentItemCategoryName]) ??
                        []
                    }
                    // allMakeOptions={allMakeOptions}
                    onMakesAssociated={handleMakesManaged} // Use the handler defined above
                    makeList={makeList}
                    makeListMutate={makeListMutate}
                    categoryMakelist={categoryMakelist} // <<< Pass prop
                    categoryMakeListMutate={categoryMakeListMutate}
                />
            )}
            {/* --- End Manage Makes Dialog --- */}
        </>
    );
};