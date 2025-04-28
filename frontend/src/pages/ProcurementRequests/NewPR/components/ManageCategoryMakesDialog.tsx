import React, { useState, useMemo, useCallback } from 'react';
import ReactSelect, { MultiValue } from 'react-select';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { X, CheckCheck } from 'lucide-react';
import { TailSpin } from 'react-loader-spinner'; // Or your preferred loader

import { MakeOption } from '../types';
import { Makelist } from '@/types/NirmaanStack/Makelist'; // Import Makelist type
import AddMakeComponent from '@/components/procurement-packages';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle, AlertDialogFooter } from '@/components/ui/alert-dialog';
import { CategoryMakelist } from '@/types/NirmaanStack/CategoryMakelist';

interface ManageCategoryMakesDialogProps {
    isOpen: boolean;
    onOpenChange: (isOpen: boolean) => void;
    categoryName: string;
    /** Array of make names (strings) currently associated with the category */
    associatedMakes: string[];
    /** Array of all available make options in the system */
    allMakeOptions: MakeOption[];
    /** Callback function when user confirms adding makes. Returns an array of MakeOption objects that were newly selected or created. */
    onMakesAssociated: (newlyAssociatedMakes: MakeOption[]) => void;
    // Mutate functions and makeList needed by AddMakeComponent
    makeList?: Makelist[];
    makeListMutate: () => Promise<any>;
    // Optional: Mutate for CategoryMakelist if direct creation happens here
    categoryMakelist?: CategoryMakelist[];
    categoryMakeListMutate?: () => Promise<any>;
}

export const ManageCategoryMakesDialog: React.FC<ManageCategoryMakesDialogProps> = ({
    isOpen,
    onOpenChange,
    categoryName,
    associatedMakes,
    allMakeOptions,
    onMakesAssociated,
    makeList,
    makeListMutate,
    categoryMakelist,
    categoryMakeListMutate // Not used directly here, but passed to AddMakeComponent
}) => {
    // State for makes selected from the existing list dropdown
    const [selectedExistingMakes, setSelectedExistingMakes] = useState<MultiValue<MakeOption>>([]);
    // State for makes newly created within this dialog session
    const [newlyCreatedMakes, setNewlyCreatedMakes] = useState<MakeOption[]>([]);
    // Loading state for the confirm button (optional, AddMakeComponent has its own)
    const [isConfirming, setIsConfirming] = useState(false);

    // Calculate options for the multi-select dropdown:
    // Show only makes that are NOT already associated with this category.
    const availableExistingMakesOptions = useMemo(() => {
        const associatedSet = new Set(associatedMakes);
        return allMakeOptions.filter(opt => !associatedSet.has(opt.value));
    }, [allMakeOptions, associatedMakes]);

    // // --- MODIFIED LOGIC ---
    // const availableExistingMakesOptions = useMemo(() => {
    //     // Ensure categoryMakelist is available and is an array
    //     // If categoryMakelist is undefined, it might still be loading in the parent.
    //     // Return empty array or handle loading state if passed down.
    //     if (!Array.isArray(categoryMakelist)) {
    //         return [];
    //     }

    //     // 1. Get make names specifically defined for this category from the prop
    //     //    (Adjust 'make' field name if different in your CategoryMakelist type)
    //     const categorySpecificMakeNames = new Set(
    //         categoryMakelist
    //             .filter(doc => doc.category === categoryName) // Filter by category name
    //             .map(doc => doc.make) // Extract the make name/value
    //     );

    //     // 2. Get makes already associated in the current session/parent component
    //     const associatedSet = new Set(associatedMakes);

    //     // 3. Filter allMakeOptions:
    //     //    - Must be in the categorySpecificMakeNames set
    //     //    - Must NOT be in the associatedSet
    //     return allMakeOptions.filter(opt =>
    //         categorySpecificMakeNames.has(opt.value) && // Check if make is defined for the category in the Doctype data
    //         !associatedSet.has(opt.value)              // Check if not already associated in the parent component's state
    //     );
    // }, [allMakeOptions, associatedMakes, categoryMakelist, categoryName]); // Added categoryMakelist and categoryName dependencies
    // // --- END MODIFIED LOGIC ---

    // Handler for when makes are selected/deselected in the multi-select
    const handleAssociateExistingMakesChange = (selectedOptions: MultiValue<MakeOption>) => {
        setSelectedExistingMakes(selectedOptions);
    };

    // Callback passed to AddMakeComponent when a new make is successfully created
    const handleNewMakeCreated = useCallback((newMake: MakeOption) => {
        // Add the newly created make to our local state for this dialog session
        setNewlyCreatedMakes(prev => {
            // Avoid adding duplicates if component somehow calls it twice
            if (!prev.some(m => m.value === newMake.value)) {
                return [...prev, newMake];
            }
            return prev;
        });
        setSelectedExistingMakes(prev => ([...prev, newMake]));
        // Optional: Maybe automatically select it in the other dropdown?
        // For now, just track it separately.
    }, []);

    // Handler for the main Confirm button of the dialog
    const handleConfirm = () => {
        setIsConfirming(true); // Show loading on confirm button if needed

        // Combine makes selected from the dropdown and those newly created
        const newlyAssociated = [
            ...selectedExistingMakes,
            ...newlyCreatedMakes
        ];

        // Remove potential duplicates just in case (e.g., created then selected)
        const uniqueNewlyAssociated = Array.from(new Map(newlyAssociated.map(item => [item.value, item])).values());


        // Call the callback passed from the parent component
        onMakesAssociated(uniqueNewlyAssociated);

        // Reset local state after confirmation (dialog will close via onOpenChange)
        setSelectedExistingMakes([]);
        setNewlyCreatedMakes([]);
        setIsConfirming(false);
    };

    // Reset local state when dialog closes
    const handleOpenChange = (open: boolean) => {
        if (!open) {
            setSelectedExistingMakes([]);
            setNewlyCreatedMakes([]);
            setIsConfirming(false); // Reset loading state
        }
        onOpenChange(open);
    }

    return (
        <AlertDialog open={isOpen} onOpenChange={handleOpenChange}>
            <AlertDialogContent className="sm:max-w-[550px]"> {/* Adjust width if needed */}
                <AlertDialogHeader>
                    <AlertDialogTitle>Manage Makes for: <span className="text-primary">{categoryName}</span></AlertDialogTitle>
                    <AlertDialogDescription>
                        Associate existing makes or create new ones for this category. Associated makes will be available in the "Make" dropdown.
                    </AlertDialogDescription>
                </AlertDialogHeader>

                <div className="py-4 space-y-4">

                    {/* Select Existing Makes */}
                    <div>
                        <Label htmlFor="associate-makes" className="font-semibold text-gray-700">Select Existing Makes:</Label>
                        <ReactSelect
                            inputId="associate-makes"
                            isMulti
                            placeholder="Select makes to associate..."
                            options={availableExistingMakesOptions}
                            value={selectedExistingMakes}
                            onChange={handleAssociateExistingMakesChange}
                            className="mt-2"
                            closeMenuOnSelect={false} // Keep menu open for multi-select
                        />
                    </div>

                    <Separator />

                    {/* Create New Make */}
                    <div>
                        <Label className="font-semibold text-gray-700 text-center">OR</Label>
                        {/* Pass the new callback to AddMakeComponent */}
                        <AddMakeComponent
                            makeList={makeList}
                            makeListMutate={makeListMutate}
                            category={categoryName}
                            categoryMakeListMutate={categoryMakeListMutate}
                            handleMakeChange={handleNewMakeCreated} // Pass the callback
                        />
                    </div>
                </div>

                <AlertDialogFooter>
                    <AlertDialogCancel asChild>
                        <Button variant="outline" disabled={isConfirming}>
                            <X className="h-4 w-4 mr-1" /> Cancel
                        </Button>
                    </AlertDialogCancel>
                    <Button
                        onClick={handleConfirm}
                        disabled={isConfirming || (selectedExistingMakes.length === 0 && newlyCreatedMakes.length === 0)} // Disable if nothing selected/created
                    >
                        {isConfirming ? (
                            <TailSpin color="white" height={20} width={20} />
                        ) : (
                            <CheckCheck className="h-4 w-4 mr-1" />
                        )}
                        Confirm
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};