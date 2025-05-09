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
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle className='text-center'>{title}</AlertDialogTitle>
                     {children && (
                         <AlertDialogDescription asChild>
                             <div>{children}</div>
                         </AlertDialogDescription>
                    )}
                </AlertDialogHeader>
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