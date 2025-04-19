import React from 'react';
import {
    AlertDialog, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Button } from '@/components/ui/button';
import { TailSpin } from 'react-loader-spinner';
import { CheckCheck, ListX } from 'lucide-react'; // Import icons

interface ConfirmationDialogProps {
    isOpen: boolean;
    onClose: () => void;
    actionType: 'approve' | 'reject' | null;
    prName: string;
    onConfirm: () => Promise<void>; // The async action handler
    isLoading: boolean;
    universalComment: string;
    handleUniversalCommentChange: (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => void
}

export const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
    isOpen, onClose, actionType, prName, onConfirm, isLoading, universalComment, 
    handleUniversalCommentChange
}) => {
    if (!actionType) return null; // Don't render if action type isn't set

    const isApproving = actionType === 'approve';
    const title = isApproving ? "Confirm PR Approval" : "Confirm PR Rejection";
    const description = `Are you sure you want to ${actionType} the Procurement Request ${prName}? Please review the details before confirming.`;
    const confirmText = isApproving ? "Confirm Approval" : "Confirm Rejection";
    const ConfirmIcon = isApproving ? CheckCheck : ListX;

    return (
        <AlertDialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{title}</AlertDialogTitle>
                    <AlertDialogDescription>{description}</AlertDialogDescription>
                </AlertDialogHeader>
                <div>
                <textarea
                    className="w-full p-2 border rounded-md min-h-[80px]"
                    placeholder={`Optional: Add a comment before ${actionType === 'approve' ? 'approving' : 'rejecting'}...`}
                    value={universalComment}
                    onChange={handleUniversalCommentChange}
                />
                </div>
                {/* Optional: Add area to display final comment if needed */}
                <AlertDialogFooter>
                    <AlertDialogCancel onClick={onClose} disabled={isLoading}>Cancel</AlertDialogCancel>
                    <Button
                        onClick={onConfirm}
                        disabled={isLoading}
                        variant={isApproving ? 'default' : 'destructive'}
                    >
                        {isLoading
                            ? <TailSpin color="#fff" height={20} width={20} />
                            : <> <ConfirmIcon className="h-4 w-4 mr-1" /> {confirmText} </>
                        }
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};