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
import { CategoryMakelist as CategoryMakelistType } from '@/types/NirmaanStack/CategoryMakelist'; // Import CategoryMakelist
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
    categoryMakelist?: CategoryMakelistType[]; // <<< Add prop
    categoryMakeListMutate?: () => Promise<any>;
    // --- End Make Props ---
}


export const AddItemForm: React.FC<AddItemFormProps> = (props) => {

    // useEffect(() => {
    //     console.log("ADD_ITEM_FORM: Received props object:", props);
    //     // Log the specific prop after checking the object
    //     console.log("ADD_ITEM_FORM: Received categoryMakelist prop:", props.categoryMakelist ? `Count=${props.categoryMakelist.length}` : props.categoryMakelist);
    // }, [props]); // Dependency on the whole props object

    const {
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
    } = props;
    // --- State for Makes ---
    const [currentMakeOption, setCurrentMakeOption] = useState<MakeOption | null>(null);
    const [isManageMakesDialogOpen, setIsManageMakesDialogOpen] = useState(false);
    // --- End State for Makes ---

    // --- Memos for Makes ---
    const currentItemCategoryName = currentItemOption?.category;

    // --- *** REVISED availableMakeOptions Logic *** ---
    const availableMakeOptions = useMemo(() => {
        // console.log(`------- Calculating availableMakeOptions for Category: ${currentItemCategoryName || 'None'} -------`);

        // Guard Clause Check
        if (!currentItemCategoryName) {
            // console.log("Step 0: No currentItemCategoryName selected.");
            return [];
        }
        if (!categoryMakelist) {
            // console.log("Step 0: categoryMakelist prop is missing or undefined.");
            return [];
        }
        if (!allMakeOptions) {
            // console.log("Step 0: allMakeOptions prop is missing or undefined.");
            return [];
        }
        // console.log(`Step 0: Inputs seem valid. Category: ${currentItemCategoryName}, categoryMakelist count: ${categoryMakelist.length}, allMakeOptions count: ${allMakeOptions.length}`);

        // Step 1: Find the relevant entry in categoryMakelist
        const categoryMakesData = categoryMakelist.filter(cm => cm.category === currentItemCategoryName);
        // console.log("CategoryMakesData: ", categoryMakesData);
        // console.log(`Step 1: Found categoryMakesData for [${currentItemCategoryName}]:`, JSON.stringify(categoryMakesData, null, 2)); // Stringify for structure

        // Step 2: Extract global make values
        const globalCategoryMakeValues = categoryMakesData?.map(childRow => {
            // Log each child row and the extracted make
            // console.log("Step 2a: Processing childRow:", JSON.stringify(childRow), " -> Extracted make:", childRow?.make);
            return childRow?.make;
        })
            .filter(makeValue => {
                // Log which makes are kept after filtering nulls/undefined
                const keep = Boolean(makeValue);
                // console.log(`Step 2b: Filtering makeValue: '${makeValue}', Keeping: ${keep}`);
                return keep;
            }) as string[] ?? []; // Provide default empty array

        // Log the final extracted list and the set created from it
        // console.log(`Step 2c: Final globalCategoryMakeValues for [${currentItemCategoryName}]:`, globalCategoryMakeValues);
        if (!Array.isArray(globalCategoryMakeValues)) {
            // console.error(`Step 2 ERROR: globalCategoryMakeValues is NOT an array! Value:`, globalCategoryMakeValues);
            return [];
        }
        const globalCategoryMakesSet = new Set(globalCategoryMakeValues);
        // console.log(`Step 2d: Created globalCategoryMakesSet:`, globalCategoryMakesSet);

        // Step 3: Get project-specific makes values
        const projectSpecificMakes = initialCategoryMakes?.[currentItemCategoryName] ?? [];
        // console.log(`Step 3a: Project specific makes (initialCategoryMakes) for [${currentItemCategoryName}]:`, projectSpecificMakes);
        if (!Array.isArray(projectSpecificMakes)) {
            // console.error(`Step 3 ERROR: projectSpecificMakes is NOT an array! Value:`, projectSpecificMakes);
            // Decide how to handle this, maybe proceed with empty set?
        }
        const projectSpecificMakesSet = new Set(projectSpecificMakes);
        // console.log(`Step 3b: Created projectSpecificMakesSet:`, projectSpecificMakesSet);


        // Step 4: Filter allMakeOptions and map/mark
        const finalOptions = allMakeOptions
            .filter(option => {
                const isIncluded = globalCategoryMakesSet.has(option?.value);
                // console.log(`Step 4a: Filtering option: { label: '${option?.label}', value: '${option?.value}' } -> Included by global set? ${isIncluded}`);
                return isIncluded;
            })
            .map(option => {
                const isProjectSpecific = projectSpecificMakesSet.has(option.value);
                const newLabel = isProjectSpecific ? `${option.label} (Project Makelist)` : option.label;
                // console.log(`Step 4b: Mapping option: { label: '${option.label}', value: '${option.value}' } -> Is project specific? ${isProjectSpecific} -> New Label: '${newLabel}'`);
                return {
                    value: option.value, // Keep original value
                    originalLabel: option.label, // Store original label for secondary sort
                    label: newLabel, // The potentially modified label for display
                    // isProjectSpecific: isProjectSpecific // Optional: add flag if preferred over string check
                };
            })
            // --- *** START: Updated Sorting Logic *** ---
            .sort((a, b) => {
                const suffix = ' (Project Makelist)';
                const aIsProject = a.label.endsWith(suffix);
                const bIsProject = b.label.endsWith(suffix);

                // 1. Primary Sort: Project-specific items first
                if (aIsProject && !bIsProject) {
                    return -1; // a (project) comes before b (non-project)
                }
                if (!aIsProject && bIsProject) {
                    return 1; // b (project) comes after a (non-project)
                }

                // 2. Secondary Sort: Alphabetical by original label
                // If both are project or both are non-project, sort by the original label
                // We stored the original label in the map step for this purpose.
                return a.originalLabel.localeCompare(b.originalLabel);
            });
        // --- *** END: Updated Sorting Logic *** ---

        // console.log(`Step 5: Final calculated availableMakeOptions (${finalOptions.length} items):`, finalOptions);
        // console.log(`--------------------------------------------------------------------`);
        return finalOptions;

    }, [currentItemCategoryName, categoryMakelist, allMakeOptions, initialCategoryMakes]);
    // --- *** END REVISED Logic *** ---
    // --- *** END REVISED Logic *** ---

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
        // This logic might need adjustment depending on whether Manage Makes
        // should now update Category Makelist or the Project's makes.
        // Assuming it still updates the *PR's local state* for now via updateCategoryMakesInStore
        if (!currentItemCategoryName || newlyAssociatedMakes.length === 0) {
            setIsManageMakesDialogOpen(false);
            return;
        }
        const makeToSelect = newlyAssociatedMakes[0];
        updateCategoryMakesInStore(currentItemCategoryName, makeToSelect.value);
        setIsManageMakesDialogOpen(false);
        // Find the potentially updated option (with or without M) to select it
        const optionToSelect = availableMakeOptions.find(opt => opt.value === makeToSelect.value) || makeToSelect;
        setCurrentMakeOption(optionToSelect);

    }, [currentItemCategoryName, updateCategoryMakesInStore, setCurrentMakeOption, availableMakeOptions]); // Added availableMakeOptions dependency
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