// // src/features/procurement-requests/components/EditItemDialog.tsx
// import React, { useState, useEffect, useCallback, useMemo } from 'react';
// import ReactSelect, { SingleValue } from 'react-select';

// import {
//     AlertDialog,
//     AlertDialogAction, // Use this for primary action
//     AlertDialogCancel,
//     AlertDialogContent,
//     AlertDialogDescription,
//     AlertDialogHeader,
//     AlertDialogTitle,
//     AlertDialogFooter,
// } from "@/components/ui/alert-dialog"; // Adjust path
// import { Button } from "@/components/ui/button";
// import { Input } from "@/components/ui/input";
// import { SelectUnit } from '@/components/helpers/SelectUnit'; // Adjust path
// import { useToast } from "@/components/ui/use-toast"; // Adjust path
// import { ListChecks, Trash2, MessageCircleMore } from "lucide-react";

// import { ProcurementRequestItem, CategoryOption } from '../types'; // Adjust path
// import { ItemStatus } from '../constants';
// import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'; // For category dropdown
// import { Category } from '@/types/NirmaanStack/Category';
// import { Label } from '@/components/ui/label';

// interface EditItemDialogProps {
//     isOpen: boolean;
//     onOpenChange: (isOpen: boolean) => void;
//     itemToEdit: ProcurementRequestItem | null;
//     categories: Category[]; // For category dropdown if needed
//     // Callback to update the item in the Zustand store
//     onSubmitUpdate: (updatedItem: ProcurementRequestItem) => void;
//     // Callback to delete the item from the Zustand store
//     onDeleteItem: (itemName: string) => void;
// }

// // Helper type for local editable state
// interface EditState {
//     quantity: string; // Use string for input control
//     comment: string;
//     // Fields editable only for 'Request' status items
//     category?: string; // Category DocName
//     itemName?: string;
//     unitName?: string;
// }

// export const EditItemDialog: React.FC<EditItemDialogProps> = ({
//     isOpen,
//     onOpenChange,
//     itemToEdit,
//     categories = [], // Default to empty array
//     onSubmitUpdate,
//     onDeleteItem,
// }) => {
//     const { toast } = useToast();
//     const [editState, setEditState] = useState<EditState | null>(null);

//     const isRequestItem = itemToEdit?.status === ItemStatus.REQUEST;

//      // Category options for the dropdown (only needed if editing category)
//      const catOptions: CategoryOption[] = useMemo(() => {
//         return categories.map(cat => ({
//            value: cat.name,
//            label: cat.category_name,
//            tax: parseFloat(cat.tax || "0"),
//            // Add newItemsDisabled if needed, though likely not relevant here
//            newItemsDisabled: false,
//        }));
//    }, [categories]);

//     // Populate local state when itemToEdit changes and dialog opens
//     useEffect(() => {
//         if (itemToEdit && isOpen) {
//             setEditState({
//                 quantity: String(itemToEdit.quantity || ''),
//                 comment: itemToEdit.comment || '',
//                 // Only populate these if it's a request item being edited
//                 category: isRequestItem ? itemToEdit.category : undefined,
//                 itemName: isRequestItem ? itemToEdit.item : undefined, // item display name
//                 unitName: isRequestItem ? itemToEdit.unit : undefined,
//             });
//         } else if (!isOpen) {
//             setEditState(null); // Reset state when closing
//         }
//     }, [itemToEdit, isOpen, isRequestItem]);

//     const handleInputChange = (field: keyof EditState, value: string) => {
//         setEditState(prev => prev ? { ...prev, [field]: value } : null);
//     };

//      const handleCategoryChange = (value: string) => {
//          handleInputChange('category', value);
//      };

//      const handleUnitChange = (value: string) => {
//          handleInputChange('unitName', value);
//      };

//     const closeDialog = useCallback(() => {
//         onOpenChange(false);
//     }, [onOpenChange]);

//     const handleUpdateConfirm = () => {
//         if (!itemToEdit || !editState) return;

//         const quantity = parseFloat(editState.quantity);
//         if (isNaN(quantity) || quantity <= 0) {
//             toast({ title: "Invalid Quantity", description: "Please enter a valid positive quantity.", variant: "destructive" });
//             return;
//         }
//         // Additional validation for request items
//         if (isRequestItem && (!editState.category || !editState.itemName || !editState.unitName)) {
//              toast({ title: "Missing Information", description: "Category, Item Name, and Unit are required for requested items.", variant: "destructive" });
//             return;
//         }

//         // Prepare updated item data
//         const updatedItemData: ProcurementRequestItem = {
//             ...itemToEdit, // Spread original item data
//             quantity: quantity,
//             comment: editState.comment.trim() || undefined,
//             // Only override these if it was a request item
//             ...(isRequestItem && {
//                 category: editState.category!,
//                 item: editState.itemName!.trim(), // Update display name
//                 unit: editState.unitName!,
//                 // Recalculate tax based on new category
//                 tax: catOptions.find(c => c.value === editState.category)?.tax ?? itemToEdit.tax,
//             }),
//         };

//         onSubmitUpdate(updatedItemData);
//         closeDialog();
//     };

//     const handleDeleteConfirm = () => {
//         if (!itemToEdit) return;
//         onDeleteItem(itemToEdit.name); // Use original name/ID for deletion
//         closeDialog();
//     };


//     if (!itemToEdit || !editState) {
//         return null; // Don't render anything if no item is selected
//     }

//     return (
//         <AlertDialog open={isOpen} onOpenChange={onOpenChange}>
//             <AlertDialogContent className="sm:max-w-lg">
//                 <AlertDialogHeader>
//                     <AlertDialogTitle className="flex justify-between items-center">
//                        <span>Edit {isRequestItem ? 'Requested' : ''} Item</span>
//                         <AlertDialogCancel className="border-none shadow-none p-0 h-6 w-6 relative -top-2 -right-2">
//                             X
//                         </AlertDialogCancel>
//                     </AlertDialogTitle>
//                     <AlertDialogDescription className="pt-1">
//                        Modify the details below or delete the item from the list.
//                     </AlertDialogDescription>
//                 </AlertDialogHeader>

//                 <div className="flex flex-col gap-4 py-2">
//                      {/* Display Item Name (Non-editable for pending items) */}
//                      <div className="grid grid-cols-3 gap-4 items-center">
//                          <Label className="dialog-label text-right">Item Name:</Label>
//                          {isRequestItem ? (
//                              <Input
//                                 value={editState.itemName ?? ''}
//                                 onChange={(e) => handleInputChange('itemName', e.target.value)}
//                                 className="col-span-2"
//                                 placeholder="Enter Item Name"
//                              />
//                          ) : (
//                             <p className="col-span-2 font-medium text-gray-800 px-1">{itemToEdit.item}</p>
//                          )}
//                      </div>

//                      {/* Category (Editable only for Request Items) */}
//                     {isRequestItem && (
//                          <div className="grid grid-cols-3 gap-4 items-center">
//                               <label className="dialog-label text-right">Category</label>
//                               <div className="col-span-2">
//                                   <Select value={editState.category ?? ''} onValueChange={handleCategoryChange}>
//                                       <SelectTrigger className="">
//                                           <SelectValue placeholder="Select Category..." />
//                                       </SelectTrigger>
//                                       <SelectContent>
//                                           {catOptions.map((cat) => (
//                                               <SelectItem key={cat.value} value={cat.value}>
//                                                   {cat.label}
//                                               </SelectItem>
//                                           ))}
//                                       </SelectContent>
//                                   </Select>
//                               </div>
//                          </div>
//                     )}

//                     {/* Unit & Quantity */}
//                     <div className="grid grid-cols-4 gap-4 items-center">
//                         <div className='col-span-2 grid grid-cols-3'>

//                          <Label className="text-right">Unit</Label>
//                          {isRequestItem ? (
//                             <div className="col-span-1">
//                                 <SelectUnit value={editState.unitName ?? ''} onChange={handleUnitChange} />
//                             </div>
//                          ) : (
//                             <p className="col-span-1 font-medium text-gray-800 px-1">{itemToEdit.unit}</p>
//                          )}
//                          </div>
//                          <div className='col-span-2 grid grid-cols-3'>
//                         <Label htmlFor="editQuantity" className="text-right col-start-2">Qty <sup className='text-red-500'>*</sup></Label>
//                         <Input
//                             id="editQuantity"
//                             type="number"
//                             inputMode='decimal'
//                             min="0"
//                             step="any"
//                             value={editState.quantity}
//                             onChange={(e) => handleInputChange('quantity', e.target.value)}
//                             className="col-span-1"
//                             placeholder="0.00"
//                         />
//                         </div>
//                     </div>

//                     {/* Comment */}
//                     <div className="grid grid-cols-3 gap-4 items-start">
//                         <label htmlFor="editComment" className="dialog-label text-right pt-2">Comment</label>
//                         <textarea
//                             id="editComment"
//                             className="col-span-2 block p-2 border-gray-300 border rounded-md w-full min-h-[60px] text-sm focus:ring-1 focus:ring-primary focus:border-primary"
//                             placeholder="Add comment (optional)..."
//                             value={editState.comment}
//                             onChange={(e) => handleInputChange('comment', e.target.value)}
//                         />
//                     </div>
//                 </div>

//                 <AlertDialogFooter className="flex flex-row justify-between items-center sm:justify-between pt-4">
//                     {/* Delete Button on the Left */}
//                      <Button
//                         variant="outline"
//                         onClick={handleDeleteConfirm}
//                         className='text-red-600 border-red-300 hover:bg-red-50'
//                     >
//                         <Trash2 className="h-4 w-4 mr-1.5" /> Delete Item
//                     </Button>
//                     {/* Cancel and Update on the Right */}
//                     <div className="flex gap-3">
//                         <AlertDialogCancel>Cancel</AlertDialogCancel>
//                         <Button onClick={handleUpdateConfirm}>
//                             <ListChecks className="h-4 w-4 mr-1.5" /> Update Item
//                         </Button>
//                     </div>
//                 </AlertDialogFooter>
//             </AlertDialogContent>
//         </AlertDialog>
//     );
// };


// src/features/procurement-requests/components/EditItemDialog.tsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import ReactSelect, { SingleValue } from 'react-select';

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
import { Label } from "@/components/ui/label"; // Import Label
import { SelectUnit } from '@/components/helpers/SelectUnit'; // Adjust path
import { useToast } from "@/components/ui/use-toast"; // Adjust path
import { ListChecks, Trash2, MessageCircleMore } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'; // Adjust path

import { ProcurementRequestItem, CategoryOption } from '../types'; // Adjust path
import { ItemStatus } from '../constants';
import { Category } from '@/types/NirmaanStack/Category';

interface EditItemDialogProps {
    isOpen: boolean;
    onOpenChange: (isOpen: boolean) => void;
    itemToEdit: ProcurementRequestItem | null;
    categories: Category[]; // For category dropdown if needed
    onSubmitUpdate: (updatedItem: ProcurementRequestItem) => void;
    onDeleteItem: (itemName: string) => void;
}

interface EditState {
    quantity: string;
    comment: string;
    category?: string;
    itemName?: string;
    unitName?: string;
}

export const EditItemDialog: React.FC<EditItemDialogProps> = ({
    isOpen,
    onOpenChange,
    itemToEdit,
    categories = [],
    onSubmitUpdate,
    onDeleteItem,
}) => {
    const { toast } = useToast();
    const [editState, setEditState] = useState<EditState | null>(null);

    const isRequestItem = itemToEdit?.status === ItemStatus.REQUEST;

    const catOptions: CategoryOption[] = useMemo(() => {
        return categories.map(cat => ({
           value: cat.name,
           label: cat.category_name,
           tax: parseFloat(cat.tax || "0"),
           newItemsDisabled: false, // Simplified for this context
       }));
   }, [categories]);

    useEffect(() => {
        if (itemToEdit && isOpen) {
            setEditState({
                quantity: String(itemToEdit.quantity || ''),
                comment: itemToEdit.comment || '',
                category: isRequestItem ? itemToEdit.category : undefined,
                itemName: isRequestItem ? itemToEdit.item : undefined,
                unitName: isRequestItem ? itemToEdit.unit : undefined,
            });
        } else if (!isOpen) {
            setEditState(null);
        }
    }, [itemToEdit, isOpen, isRequestItem]);

    const handleInputChange = (field: keyof EditState, value: string) => {
        setEditState(prev => prev ? { ...prev, [field]: value } : null);
    };

    const handleCategoryChange = (value: string) => {
        handleInputChange('category', value);
    };

    const handleUnitChange = (value: string) => {
        handleInputChange('unitName', value);
    };

    const closeDialog = useCallback(() => {
        onOpenChange(false);
    }, [onOpenChange]);

    const handleUpdateConfirm = () => {
        // ... (validation and submission logic remains the same) ...
         if (!itemToEdit || !editState) return;

        const quantity = parseFloat(editState.quantity);
        if (isNaN(quantity) || quantity <= 0) {
            toast({ title: "Invalid Quantity", description: "Please enter a valid positive quantity.", variant: "destructive" });
            return;
        }
        if (isRequestItem && (!editState.category || !editState.itemName || !editState.unitName)) {
             toast({ title: "Missing Information", description: "Category, Item Name, and Unit are required for requested items.", variant: "destructive" });
            return;
        }

        const updatedItemData: ProcurementRequestItem = {
            ...itemToEdit,
            quantity: quantity,
            comment: editState.comment.trim() || undefined,
            ...(isRequestItem && {
                category: editState.category!,
                item: editState.itemName!.trim(),
                unit: editState.unitName!,
                tax: catOptions.find(c => c.value === editState.category)?.tax ?? itemToEdit.tax,
            }),
        };

        onSubmitUpdate(updatedItemData);
        closeDialog();
    };

    const handleDeleteConfirm = () => {
        if (!itemToEdit) return;
        onDeleteItem(itemToEdit.name);
        closeDialog();
    };


    if (!itemToEdit || !editState) {
        return null;
    }

    // Consistent styling for labels
    const labelClass = "text-sm font-medium text-gray-700 text-right";

    return (
        <AlertDialog open={isOpen} onOpenChange={onOpenChange}>
            {/* Increased max-width slightly for better spacing */}
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

                {/* Use a consistent grid for the main form layout */}
                <div className="space-y-4 py-3">
                     {/* Row 1: Item Name */}
                     <div className="grid grid-cols-4 gap-x-4 items-center">
                         <Label htmlFor='editItemNameDisplay' className={labelClass}>Item Name</Label>
                         <div className="col-span-3">
                             {isRequestItem ? (
                                 <Input
                                    id='editItemNameDisplay'
                                    value={editState.itemName ?? ''}
                                    onChange={(e) => handleInputChange('itemName', e.target.value)}
                                    placeholder="Enter Item Name"
                                 />
                             ) : (
                                <p className="font-medium text-gray-800 py-2">{itemToEdit.item}</p>
                             )}
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

                    {/* Row 3: Unit & Quantity */}
                    <div className="grid grid-cols-4 gap-x-4 items-start"> {/* items-start to align labels with top */}
                        <div className={labelClass}> {/* Empty label cell for alignment */}
                           Unit / Qty *
                        </div>
                        {/* Container for Unit and Qty inputs side-by-side */}
                        <div className="col-span-3 grid grid-cols-2 gap-4">
                             {/* Unit Section */}
                             <div className='space-y-1'>
                                {/* Optional Label (can be removed if header is clear enough) */}
                                <Label htmlFor="editUnit" className='text-xs text-gray-500 pl-1'>Unit</Label>
                                {isRequestItem ? (
                                    <SelectUnit value={editState.unitName ?? ''} onChange={handleUnitChange} />
                                ) : (
                                    <p className="font-medium text-gray-800 h-9 flex items-center px-1">{itemToEdit.unit}</p> // Match input height
                                )}
                             </div>
                             {/* Quantity Section */}
                             <div className='space-y-1'>
                                 <Label htmlFor="editQuantity" className='text-xs text-gray-500 pl-1'>Quantity <sup className='text-red-500'>*</sup></Label>
                                 <Input
                                    id="editQuantity"
                                    type="number"
                                    inputMode='decimal'
                                    min="0"
                                    step="any"
                                    value={editState.quantity}
                                    onChange={(e) => handleInputChange('quantity', e.target.value)}
                                    placeholder="0.00"
                                    className="h-9" // Match SelectUnit height
                                />
                             </div>
                        </div>
                    </div>


                    {/* Row 4: Comment */}
                    <div className="grid grid-cols-4 gap-x-4 items-start">
                        <Label htmlFor="editComment" className={`${labelClass} pt-2`}>Comment</Label>
                        <div className="col-span-3">
                             <textarea
                                id="editComment"
                                className="block p-2 border-gray-300 border rounded-md w-full min-h-[70px] text-sm focus:ring-1 focus:ring-primary focus:border-primary"
                                placeholder="Add comment (optional)..."
                                value={editState.comment}
                                onChange={(e) => handleInputChange('comment', e.target.value)}
                            />
                        </div>
                    </div>
                </div>

                <AlertDialogFooter className="flex flex-row justify-between items-center sm:justify-between pt-4 mt-2 border-t">
                     <Button
                        variant="outline"
                        onClick={handleDeleteConfirm}
                        className='text-red-600 border-red-300 hover:bg-red-50'
                    >
                        <Trash2 className="h-4 w-4 mr-1.5" /> Delete Item
                    </Button>
                    <div className="flex gap-3">
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <Button onClick={handleUpdateConfirm}>
                            <ListChecks className="h-4 w-4 mr-1.5" /> Update Item
                        </Button>
                    </div>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};