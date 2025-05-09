import React from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"; // Adjust path
import { Button } from '@/components/ui/button'; // Adjust path
import { TailSpin } from 'react-loader-spinner';

interface RevertPRDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => Promise<void>; // Async action
    isLoading: boolean;
}

export const RevertPRDialog: React.FC<RevertPRDialogProps> = ({ isOpen, onClose, onConfirm, isLoading }) => {
    return (
        <AlertDialog open={isOpen} onOpenChange={onClose}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Revert RFQ Selections?</AlertDialogTitle>
                    <AlertDialogDescription>
                        Are you sure? This will remove all selected vendor quotes and makes from this PR. The PR workflow state will be set back to 'Approved'. This action cannot be easily undone.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={isLoading}>Cancel</AlertDialogCancel>
                    <Button onClick={onConfirm} disabled={isLoading} variant="destructive">
                        {isLoading ? <TailSpin color="#fff" height={20} width={20} /> : "Confirm Revert"}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};