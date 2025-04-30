// src/features/procurement-requests/components/ManageCategoryMakesDialog.tsx
import React, { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { X, CheckCheck } from 'lucide-react';
import { TailSpin } from 'react-loader-spinner';

import { MakeOption } from '../types';
import { Makelist } from '@/types/NirmaanStack/Makelist';
import { CategoryMakelist } from '@/types/NirmaanStack/CategoryMakelist';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle, AlertDialogFooter } from '@/components/ui/alert-dialog';
import { useFrappeCreateDoc } from 'frappe-react-sdk';
import { useToast } from '@/components/ui/use-toast';

interface ManageCategoryMakesDialogProps {
    isOpen: boolean;
    onOpenChange: (isOpen: boolean) => void;
    categoryName: string;
    associatedMakes: string[];
    // allMakeOptions removed as prop as it's not used here anymore
    onMakesAssociated: (newlyAssociatedMakes: MakeOption[]) => void;
    makeList?: Makelist[];
    makeListMutate: () => Promise<any>;
    categoryMakelist?: CategoryMakelist[];
    categoryMakeListMutate?: () => Promise<any>;
}

export const ManageCategoryMakesDialog: React.FC<ManageCategoryMakesDialogProps> = ({
    isOpen,
    onOpenChange,
    categoryName,
    associatedMakes,
    onMakesAssociated,
    makeList,
    makeListMutate,
    categoryMakelist,
    categoryMakeListMutate
}) => {
    // --- Hooks ---
    const { createDoc } = useFrappeCreateDoc();
    const { toast } = useToast();

    // --- State ---
    const [newMakeInput, setNewMakeInput] = useState<string>('');
    const [isLoading, setIsLoading] = useState(false);

    // --- Handlers ---
    const handleNewMakeInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setNewMakeInput(event.target.value);
    };

    const handleConfirmCreateAndAssociate = useCallback(async () => {
        if (!newMakeInput.trim() || !categoryName) return;

        const newMakeName = newMakeInput.trim();
        setIsLoading(true);

        try {
            // 1. Check Makelist
            const existingMake = makeList?.find(m => m.make_name.toLowerCase() === newMakeName.toLowerCase());
            let makeDocName: string;
            let createdNewMakeInList = false;

            if (existingMake) {
                makeDocName = existingMake.name;
                // Check if already associated *based on parent's state passed via props*
                if (associatedMakes.includes(makeDocName)) {
                    toast({ title: "Already Associated", description: `Make "${existingMake.make_name}" is already associated with this category.`, variant: "info" });
                    setIsLoading(false);
                    // Optionally keep the dialog open and clear input or let parent handle closing
                    // setNewMakeInput('');
                    return; // Stop processing, nothing new to associate *now*
                }
                // If make exists but isn't associated yet, proceed.
            } else {
                // 2. Create in Makelist if new
                const newMakeDoc = await createDoc("Makelist", { make_name: newMakeName });
                makeDocName = newMakeDoc.name;
                createdNewMakeInList = true;
            }

            // --- Refined Association Logic ---
            // 3. Check if the association *already exists in the backend data* BEFORE creating
            const existingAssociation = categoryMakelist?.find(
                cm => cm.category === categoryName && cm.make === makeDocName
            );
            let createdNewAssociation = false;

            if (!existingAssociation) {
                // 4. Create association in Category Makelist ONLY if it doesn't exist
                await createDoc("Category Makelist", {
                    category: categoryName,
                    make: makeDocName
                });
                createdNewAssociation = true;
            }
            // --- End Refined Association Logic ---

            // 5. Prepare the MakeOption to be returned
            const newMakeOption: MakeOption = { value: makeDocName, label: newMakeName };

            // 6. Call the parent callback with the newly created/associated make
            onMakesAssociated([newMakeOption]); // Pass as single-item array

            // 7. Show success toast
            toast({ title: "Make Associated", description: `"${newMakeName}" processed for association.`, variant: "success" });

            // 8. Mutate backend data lists
            if (createdNewMakeInList) await makeListMutate();
            if (createdNewAssociation) await categoryMakeListMutate?.(); // Only mutate if a *new* doc was created

            // Closing is handled by parent

        } catch (error: any) {
            console.error("Error creating/associating make:", error);
            toast({ title: "Error", description: `Failed to process make: ${error.message || 'Unknown error'}`, variant: "destructive" });
        } finally {
            setIsLoading(false);
        }
    }, [
        newMakeInput,
        categoryName,
        makeList,
        associatedMakes,
        categoryMakelist,
        createDoc,
        onMakesAssociated,
        makeListMutate,
        categoryMakeListMutate,
        toast
    ]);

    // Reset handler remains the same
    const handleOpenChange = (open: boolean) => {
        if (!open) {
            setNewMakeInput('');
            setIsLoading(false);
        }
        onOpenChange(open);
    }

    const isConfirmDisabled = isLoading || !newMakeInput.trim();

    return (
        <AlertDialog open={isOpen} onOpenChange={handleOpenChange}>
            <AlertDialogContent className="sm:max-w-[450px]">
                <AlertDialogHeader>
                    <AlertDialogTitle>Add New Make for: <span className="text-primary">{categoryName}</span></AlertDialogTitle>
                    <AlertDialogDescription>
                        Enter a new make name. It will be created (if needed) and associated upon confirmation.
                    </AlertDialogDescription>
                </AlertDialogHeader>

                <div className="py-4 space-y-2">
                    <div>
                        <Label htmlFor="new-make-input" className="font-semibold text-gray-700 block mb-2">
                            New Make Name: <span className="text-red-500">*</span>
                        </Label>
                        <Input
                            id="new-make-input"
                            type="text"
                            placeholder="Enter make name..."
                            value={newMakeInput}
                            onChange={handleNewMakeInputChange}
                            className="h-9"
                            disabled={isLoading}
                            autoFocus // Good practice to add autofocus
                        />
                    </div>
                </div>

                <AlertDialogFooter>
                    <AlertDialogCancel disabled={isLoading}>
                        Cancel
                    </AlertDialogCancel>
                    <Button
                        type="button"
                        onClick={handleConfirmCreateAndAssociate}
                        disabled={isConfirmDisabled}
                    >
                        {isLoading ? (
                            <TailSpin color="white" height={20} width={20} />
                        ) : (
                            <CheckCheck className="h-4 w-4 mr-1" />
                        )}
                        Confirm & Associate
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};