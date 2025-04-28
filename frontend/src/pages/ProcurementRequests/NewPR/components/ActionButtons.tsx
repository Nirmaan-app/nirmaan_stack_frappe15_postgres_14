// src/features/procurement-requests/components/ActionButtons.tsx
import React, { useEffect, useState } from 'react';
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"; // Adjust path
import { ListChecks, CheckCheck } from "lucide-react";
import { TailSpin } from 'react-loader-spinner'; // Adjust path

interface ActionButtonsProps {
    mode: 'create' | 'edit' | 'resolve';
    onSubmit: () => Promise<void>; // The function to call on confirm
    isSubmitting: boolean;
    disabled?: boolean; // e.g., disable if procList is empty
    comment?: string; // Pass comment to show in dialog if needed
    onCommentChange?: (comment: string) => void; // Allow comment editing in dialog
}

export const ActionButtons: React.FC<ActionButtonsProps> = ({
    mode,
    onSubmit,
    isSubmitting,
    disabled = false,
    comment,
    onCommentChange
}) => {
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [localComment, setLocalComment] = useState(comment ?? '');

    useEffect(() => {
        setLocalComment(comment ?? ''); // Sync local comment if prop changes
    }, [comment]);


    const buttonLabel = mode === 'create' ? 'Submit Request' : mode === 'edit' ? 'Update Request' : 'Resolve Request';
    const dialogTitle = mode === 'create' ? 'Confirm New Request?' : mode === 'edit' ? 'Confirm Update?' : 'Confirm Resolution?';
    const dialogDescription = mode === 'create'
        ? "Submitting will create a new Procurement Request. Older pending PRs for the same Project & Package might be merged. Continue?"
        : mode === 'edit'
        ? "Updating will save the changes to this Procurement Request and send it for approval. Continue?"
        : "Resolving will send this previously rejected Procurement Request back for approval. Continue?";

    const handleConfirm = async () => {
        if(onCommentChange) {
            onCommentChange(localComment); // Update comment in parent store before submitting
        }
        await onSubmit();
        // Dialog might be closed automatically by parent state change after submit,
        // but explicitly setting it can be safer if submission fails without state change.
        // Consider closing only on success in the parent.
        // setIsDialogOpen(false);
    };

    return (
        <AlertDialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <AlertDialogTrigger asChild>
                <Button
                    disabled={disabled || isSubmitting}
                    variant={disabled ? "secondary" : "default"} // Use default for primary action
                    className="w-full mt-4 h-10"
                >
                    {isSubmitting ? (
                        <TailSpin width={20} height={20} color="white" />
                    ) : (
                        <div className="flex items-center gap-1.5">
                            <ListChecks className="h-4 w-4" />
                            {buttonLabel}
                        </div>
                    )}
                </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="sm:max-w-md">
                <AlertDialogHeader>
                    <AlertDialogTitle>{dialogTitle}</AlertDialogTitle>
                    <AlertDialogDescription>
                        {dialogDescription}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                 {/* Optional: Allow final comment edit in dialog */}
                 {onCommentChange && (
                     <textarea
                        className="w-full border rounded-lg p-2 min-h-[70px] mt-2 text-sm focus:ring-1 focus:ring-primary focus:border-primary"
                        placeholder="Add final comments (optional)..."
                        value={localComment}
                        onChange={(e) => setLocalComment(e.target.value)}
                        disabled={isSubmitting}
                    />
                 )}
                <div className="flex justify-end gap-3 mt-4">
                    <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
                    <Button
                        onClick={handleConfirm}
                        disabled={isSubmitting}
                        className="flex items-center gap-1 min-w-[100px]"
                    >
                        {isSubmitting ? (
                            <TailSpin width={18} height={18} color="white" />
                        ) : (
                           <>
                             <CheckCheck className="h-4 w-4" />
                             Confirm
                           </>
                        )}
                    </Button>
                </div>
            </AlertDialogContent>
        </AlertDialog>
    );
};