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
        // 1. Check the current derived category list in the orderData state
        const derivedCategoryDetails = orderDataCategoryList.find(c => c.name === currentItemCategoryName);
        if (derivedCategoryDetails && Array.isArray(derivedCategoryDetails.makes)) {
            makesForCategory = derivedCategoryDetails.makes;
        }
        // 2. If not found or no makes there, check the initial baseline makes
        else if (initialCategoryMakes && initialCategoryMakes[currentItemCategoryName]) {
            makesForCategory = initialCategoryMakes[currentItemCategoryName];
        }

        // Use a Set for efficient lookup and deduplication
        const makesSet = new Set(Array.isArray(makesForCategory) ? makesForCategory : []);

        // Filter allMakeOptions based on the makes associated with the category
        return allMakeOptions.filter(opt => makesSet.has(opt.value));

    }, [currentItemCategoryName, orderDataCategoryList, initialCategoryMakes, allMakeOptions]);
    // --- End Memos for Makes ---

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

    const handleMakesManaged = useCallback((newlyAssociatedMakes: MakeOption[]) => {
        if (!currentItemCategoryName) return;
        let makeToSelectAfterwards: MakeOption | null = null;

        // Update the local state cache in the hook for each newly associated make
        newlyAssociatedMakes.forEach(make => {
            updateCategoryMakesInStore(currentItemCategoryName, make.value);
            // Prepare to auto-select the first one added
            if (!makeToSelectAfterwards) {
                makeToSelectAfterwards = make;
            }
        });

        setIsManageMakesDialogOpen(false);

        // Auto-select the first newly added/associated make
        if (makeToSelectAfterwards) {
            // Find the full option object from allMakeOptions to ensure label is included
            const fullOption = allMakeOptions.find(opt => opt.value === makeToSelectAfterwards!.value);
            if (fullOption) {
                setCurrentMakeOption(fullOption); // Update local state directly
            }
        }
    }, [currentItemCategoryName, updateCategoryMakesInStore, allMakeOptions]);

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

    // --- Modified Close Handler ---
    const handleCloseDialog = () => {
        // Reset make state when dialog closes
        setCurrentMakeOption(null);
        onClose(); // Call original close handler
    };
    // --- End Modified Close Handler ---
    return (
        <>
            <AlertDialog open={showNewItemsCard} onOpenChange={(open) => !open && handleCloseDialog()}>
                <AlertDialogContent className="sm:max-w-[750px]"> {/* Wider content for more fields */}
                    <AlertDialogHeader>
                        <AlertDialogTitle className="flex justify-between items-center">
                            <span>Add Missing Product</span>
                            {/* Use standard AlertDialogCancel for consistent closing */}
                            <AlertDialogCancel
                                onClick={handleCloseDialog}
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
                                        // Pass custom props/handlers for "Manage Makes"
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

                        <div className="flex justify-between items-center mt-4 pt-4 border-t"> {/* Added border */}
                            {canCreateItem ? (
                                <Button
                                    variant="link"
                                    className="text-sm p-0 h-auto text-blue-600 hover:text-blue-800"
                                    onClick={onToggleNewItemDialog}
                                    disabled={isLoading}
                                >
                                    <CirclePlus className="w-4 h-4 mr-1" /> Create New Product
                                </Button>
                            ) : <div />} {/* Placeholder */}

                            <div className='flex items-center gap-2'>
                                <AlertDialogCancel onClick={handleCloseDialog}>Cancel</AlertDialogCancel>
                                <Button
                                    onClick={handleAddClick} // Use the modified handler
                                    disabled={!currentItemOption || !quantity || parseNumber(quantity) <= 0 || isLoading}
                                    size="sm"
                                >
                                    {isLoading ? "Adding..." : "Add Product"}
                                </Button>
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
                    allMakeOptions={allMakeOptions}
                    onMakesAssociated={handleMakesManaged} // Use the handler defined above
                    makeList={makeList}
                    makeListMutate={makeListMutate}
                    categoryMakeListMutate={categoryMakeListMutate}
                />
            )}
            {/* --- End Manage Makes Dialog --- */}
        </>
    );
};