import React from 'react';
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogFooter, // Use Footer for better button alignment
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { TailSpin } from 'react-loader-spinner'; // Or your preferred loader
import { Trash2, CheckCheck, X } from 'lucide-react'; // Icons for clarity

interface SRDeleteConfirmationDialogProps {
    /** Controls the visibility of the dialog */
    open: boolean;
    /** Function to call when the dialog's open state should change (e.g., on cancel or overlay click) */
    onOpenChange: () => void;
    /** The name or identifier of the item being deleted (e.g., "SR/00123") */
    itemName: string | undefined;
    /** The type of item being deleted (e.g., "Service Request", "Procurement Request") */
    itemType?: string;
    /** Function to execute when the user confirms the deletion */
    onConfirm: () => void;
    /** Flag indicating if the deletion process is currently running */
    isDeleting: boolean;
    /** Optional custom title for the dialog */
    title?: string;
    /** Optional custom description for the dialog */
    description?: React.ReactNode;
}

export const SRDeleteConfirmationDialog: React.FC<SRDeleteConfirmationDialogProps> = ({
    open,
    onOpenChange,
    itemName,
    itemType = "Item", // Default item type
    onConfirm,
    isDeleting,
    title,
    description,
}) => {
    const effectiveTitle = title || `Delete ${itemType}`;
    const effectiveDescription = description || (
        <>
            Are you sure you want to delete this {itemType}: <strong className="text-red-600">{itemName || 'N/A'}</strong>?
            <br />
            This action cannot be undone.
        </>
    );

    return (
        <AlertDialog open={open} onOpenChange={(open) => !open && onOpenChange()}>
            <AlertDialogContent className="sm:max-w-[425px]">
                <AlertDialogHeader className="text-center space-y-2">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
                         <Trash2 className="h-6 w-6 text-red-600" aria-hidden="true" />
                    </div>
                    <AlertDialogTitle>{effectiveTitle}</AlertDialogTitle>
                    <AlertDialogDescription className="text-sm text-gray-500">
                        {effectiveDescription}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter className="mt-4 flex flex-col-reverse sm:flex-row sm:justify-center sm:space-x-2 gap-2 sm:gap-0">
                    {isDeleting ? (
                        <div className="flex justify-center items-center w-full h-[40px]">
                            <TailSpin color="red" width={30} height={30} />
                        </div>
                    ) : (
                        <>
                            <AlertDialogCancel asChild>
                                <Button variant="outline" className="w-full sm:w-auto">
                                    <X className="h-4 w-4 mr-1" />
                                    Cancel
                                </Button>
                            </AlertDialogCancel>
                            <Button
                                variant="destructive"
                                onClick={onConfirm}
                                disabled={isDeleting}
                                className="w-full sm:w-auto"
                            >
                                <CheckCheck className="h-4 w-4 mr-1" />
                                Confirm Delete
                            </Button>
                        </>
                    )}
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};