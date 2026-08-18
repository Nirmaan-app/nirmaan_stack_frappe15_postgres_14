import React from 'react';
import {
    AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog"; // Adjust path
import { Button } from "@/components/ui/button"; // Adjust path
import { TailSpin } from 'react-loader-spinner';
import { CheckCheck, Undo2 } from 'lucide-react';

interface ConfirmationDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => Promise<void>; // Async action
    isLoading: boolean;
    title: string;
    children?: React.ReactNode; // To inject specific content like comment box
    confirmText?: string;
    cancelText?: string;
    confirmVariant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
}

export const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
    isOpen, onClose, onConfirm, isLoading, title, children,
    confirmText = "Confirm", cancelText = "Cancel", confirmVariant = "default"
}) => {
    return (
        <AlertDialog open={isOpen} onOpenChange={onClose}>
            {/* Bounded height + a scrollable body row, so tall content (e.g. the
                invoice-approval comparison with its line-item mapping table) can
                never push the Cancel/Confirm footer off-screen. The 1fr row only
                bites once the content exceeds max-h, so short dialogs are
                unchanged. */}
            <AlertDialogContent className="max-h-[85vh] grid-rows-[auto_minmax(0,1fr)_auto]">
                <AlertDialogHeader>
                    <AlertDialogTitle className='text-center'>{title}</AlertDialogTitle>
                </AlertDialogHeader>
                {children && (
                    <AlertDialogDescription asChild>
                        <div className="overflow-y-auto pr-1">{children}</div>
                    </AlertDialogDescription>
                )}
                 <AlertDialogFooter>
                     <AlertDialogCancel disabled={isLoading} className="flex items-center gap-1">
                         <Undo2 className="h-4 w-4" />
                         {cancelText}
                     </AlertDialogCancel>
                     <Button onClick={onConfirm} disabled={isLoading} variant={confirmVariant} className='flex items-center gap-1'>
                        {isLoading ? <TailSpin color={confirmVariant === 'destructive' || confirmVariant === 'default' ? '#fff' : 'hsl(var(--primary))'} height={20} width={20} /> : <CheckCheck className="h-4 w-4" />}
                         {confirmText}
                     </Button>
                 </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};