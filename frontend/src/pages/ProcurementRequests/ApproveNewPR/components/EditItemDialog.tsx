// src/features/approve-pr/components/EditItemDialog.tsx

// ... other imports ...
import ReactSelect, { SingleValue } from 'react-select';
import { ListChecks, Trash2, CirclePlus, Pencil, X } from "lucide-react";
import { EditItemState as ExtendedEditItemState, PRCategory } from '../types'; // Adjust types if needed
import { Makelist } from '@/types/NirmaanStack/Makelist';
import { CategoryMakesMap, CategorySelection, MakeOption } from '../../NewPR/types';
import { useCallback, useMemo, useState } from 'react';
import { parseNumber } from '@/utils/parseNumber';
import {AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger} from "@/components/ui/alert-dialog";
import { Label } from '@/components/ui/label';
import { CustomMakeMenuList } from '../../NewPR/components/ItemSelectorControls';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { TailSpin } from 'react-loader-spinner';
import { ManageCategoryMakesDialog } from '../../NewPR/components/ManageCategoryMakesDialog';

// Extend EditItemState locally if not done globally
interface EditState extends ExtendedEditItemState {
    makeValue?: string; // Store make value
}

interface EditItemDialogProps {
    isOpen: boolean;
    onClose: () => void;
    editItem: ExtendedEditItemState | null; // Use extended type if defined globally
    handleEditItemChange: (field: keyof ExtendedEditItemState, value: string | number | undefined) => void; // Allow undefined for make/comment
    onSave: () => void;
    onDelete: (itemToDelete: ExtendedEditItemState) => void;
    isLoading: boolean;

    // --- Make Props (NEW) ---
    allMakeOptions: MakeOption[];
    initialCategoryMakes: CategoryMakesMap; // Baseline makes for the WP
    selectedCategories: PRCategory[]; // Current derived categories state
    updateCategoryMakesInStore: (categoryName: string, newMake: string) => void;
    makeList?: Makelist[];
    makeListMutate: () => Promise<any>;
    categoryMakeListMutate?: () => Promise<any>;
    // --- End Make Props ---
}

export const EditItemDialog: React.FC<EditItemDialogProps> = ({
    isOpen, onClose, editItem, handleEditItemChange, onSave, onDelete, isLoading,
    // Make Props
    allMakeOptions,
    initialCategoryMakes,
    selectedCategories,
    updateCategoryMakesInStore,
    makeList,
    makeListMutate,
    categoryMakeListMutate
}) => {
    if (!editItem) return null;

    // Local state for dialog-specific interactions if needed,
    // but primary edit state comes from props (editItem)
    // State for Manage Makes Dialog specific to this Edit Dialog instance
    const [isManageMakesDialogOpen, setIsManageMakesDialogOpen] = useState(false);

    // --- Memos ---
    const currentItemCategoryName = editItem?.category; // Get category from the item being edited

    const availableMakeOptions = useMemo(() => {
        if (!currentItemCategoryName) return [];
        let makesForCategory: string[] = [];
        const derivedCategoryDetails = selectedCategories.find(c => c.name === currentItemCategoryName);

        if (derivedCategoryDetails && Array.isArray(derivedCategoryDetails.makes)) {
            makesForCategory = derivedCategoryDetails.makes;
        } else if (initialCategoryMakes && initialCategoryMakes[currentItemCategoryName]) {
            makesForCategory = initialCategoryMakes[currentItemCategoryName];
        }
        const makesSet = new Set(Array.isArray(makesForCategory) ? makesForCategory : []);
        return allMakeOptions.filter(opt => makesSet.has(opt.value));
    }, [currentItemCategoryName, selectedCategories, initialCategoryMakes, allMakeOptions]);

    // Get the currently selected MakeOption object based on editItem.make
    const currentMakeOption = useMemo(() => {
        if (!editItem?.make) return null;
        return availableMakeOptions.find(opt => opt.value === editItem.make) ||
               allMakeOptions.find(opt => opt.value === editItem.make) || // Fallback check in all options
               null;
    }, [editItem?.make, availableMakeOptions, allMakeOptions]);

    // --- Handlers ---
    const handleMakeChange = (selectedOption: SingleValue<MakeOption>) => {
        // Call the prop handler to update the parent state
        handleEditItemChange('make', selectedOption?.value || undefined);
    };

     const handleOpenManageMakesDialog = useCallback(() => {
         if (!currentItemCategoryName) {
             // Maybe show a toast? This shouldn't happen if item exists.
             console.error("Cannot manage makes, item category not found.");
             return;
         }
         setIsManageMakesDialogOpen(true);
     }, [currentItemCategoryName]);

     const handleMakesManaged = useCallback((newlyAssociatedMakes: MakeOption[]) => {
         if (!currentItemCategoryName) return;
         let makeToSelectAfterwards: MakeOption | null = null;

         newlyAssociatedMakes.forEach(make => {
             updateCategoryMakesInStore(currentItemCategoryName, make.value);
             if (!makeToSelectAfterwards) {
                 makeToSelectAfterwards = make;
             }
         });

         setIsManageMakesDialogOpen(false);

         // Auto-select the first newly added/associated make
         if (makeToSelectAfterwards) {
             const fullOption = allMakeOptions.find(opt => opt.value === makeToSelectAfterwards!.value);
             if (fullOption) {
                handleMakeChange(fullOption); // Update state via prop handler
             }
         }
     }, [currentItemCategoryName, updateCategoryMakesInStore, allMakeOptions, handleMakeChange]); // Include handleMakeChange

    // Custom props for the Make ReactSelect
    const makeSelectCustomProps = {
        onManageMakesClick: handleOpenManageMakesDialog,
    };

    // --- Validation ---
    const canSave = parseNumber(editItem.quantity) > 0;

    return (
        <>
            <AlertDialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
                <AlertDialogContent className="sm:max-w-[600px]"> {/* Consistent width */}
                    <AlertDialogHeader>
                         <AlertDialogTitle className="flex justify-between items-center">
                             <span>Edit Product: {editItem.item}</span>
                              <AlertDialogCancel onClick={onClose} className="border-none shadow-none p-0 h-6 w-6 relative -top-2 -right-2">
                                  X
                              </AlertDialogCancel>
                         </AlertDialogTitle>
                         <AlertDialogDescription className="pt-1">
                             Update the quantity, make, or add a comment for this product.
                         </AlertDialogDescription>
                    </AlertDialogHeader>

                    <div className="grid gap-4 py-4">
                        {/* Item Name (Read Only) */}
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label className="text-right">Product Name</Label>
                            <p className="col-span-3 text-sm font-medium py-2">{editItem.item}</p>
                        </div>

                         {/* --- Make Selector --- */}
                         <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor='edit-make-select' className="text-right">Make</Label>
                            <div className="col-span-3">
                                <ReactSelect
                                    inputId='edit-make-select'
                                    placeholder="Select or Add Make..."
                                    value={currentMakeOption} // Use derived option
                                    isDisabled={isLoading || !currentItemCategoryName}
                                    options={availableMakeOptions}
                                    onChange={handleMakeChange} // Update state via handler
                                    onManageMakesClick={handleOpenManageMakesDialog}
                                    components={{ MenuList: CustomMakeMenuList }}
                                    selectProps={{ customProps: makeSelectCustomProps }}
                                    isClearable
                                />
                            </div>
                         </div>
                         {/* --- End Make Selector --- */}

                        {/* Unit (Read Only) & Quantity */}
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label className="text-right">Unit & Qty <span className='text-red-500'>*</span></Label>
                            <div className="col-span-3 flex gap-2">
                                <div className='w-1/2'>
                                    <Input value={editItem.unit || ''} readOnly className='bg-gray-100 cursor-not-allowed h-9' />
                                </div>
                                <div className='w-1/2'>
                                    <Input
                                        type="number"
                                        id="quantity"
                                        placeholder="Quantity"
                                        value={editItem.quantity || ''}
                                        // Use the prop handler directly
                                        onChange={(e) => handleEditItemChange('quantity', e.target.value)}
                                        min="0.01"
                                        step="any"
                                        disabled={isLoading}
                                        className="h-9"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Comment */}
                        <div className="grid grid-cols-4 items-start gap-4"> {/* Use items-start */}
                            <Label htmlFor="comment" className="text-right pt-2">Comment</Label>
                            <Textarea
                                id="comment"
                                placeholder="(Optional) Add or update comment"
                                value={editItem.comment || ''}
                                // Use the prop handler directly
                                onChange={(e) => handleEditItemChange('comment', e.target.value)}
                                className="col-span-3 min-h-[70px]"
                                disabled={isLoading}
                            />
                        </div>
                    </div>

                    <AlertDialogFooter className="flex justify-between items-center sm:justify-between pt-4 mt-2 border-t">
                        {/* Delete Trigger */}
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button variant="destructive" size="sm" disabled={isLoading}>
                                    <Trash2 className='h-4 w-4 mr-1'/> Delete Product
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                {/* ... Delete confirmation content ... */}
                                 <AlertDialogHeader>
                                     <AlertDialogTitle>Delete Product from PR?</AlertDialogTitle>
                                     <AlertDialogDescription>
                                         Are you sure you want to remove "{editItem.item}" from this Procurement Request?
                                    </AlertDialogDescription>
                                 </AlertDialogHeader>
                                 <AlertDialogFooter>
                                     <AlertDialogCancel>Cancel</AlertDialogCancel>
                                     <AlertDialogAction onClick={() => onDelete(editItem)} className='bg-destructive hover:bg-destructive/90'>Confirm Delete</AlertDialogAction>
                                 </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>

                        {/* Save and Cancel Buttons */}
                        <div className='flex gap-2'>
                            <AlertDialogCancel disabled={isLoading}>Cancel</AlertDialogCancel>
                            <Button onClick={onSave} disabled={!canSave || isLoading}>
                                {isLoading ? <TailSpin color="#fff" height={20} width={20} /> : "Save Changes"}
                            </Button>
                        </div>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

             {/* --- Manage Makes Dialog Instance --- */}
             {currentItemCategoryName && (
                 <ManageCategoryMakesDialog
                    isOpen={isManageMakesDialogOpen}
                    onOpenChange={setIsManageMakesDialogOpen}
                    categoryName={currentItemCategoryName}
                    associatedMakes={
                        (selectedCategories.find(c => c.name === currentItemCategoryName)?.makes) ??
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