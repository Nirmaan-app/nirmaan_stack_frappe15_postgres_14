import React from 'react';
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogFooter,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { TailSpin } from 'react-loader-spinner';
import { Lock, Unlock, X, AlertTriangle } from 'lucide-react';

interface SRFinalizeDialogProps {
    /** Controls the visibility of the dialog */
    open: boolean;
    /** Function to call when the dialog's open state should change */
    onOpenChange: (open: boolean) => void;
    /** The SR name (e.g., "SR-PROJ-00001") */
    srName: string | undefined;
    /** Function to execute when the user confirms finalization */
    onConfirm: () => void;
    /** Flag indicating if the operation is in progress */
    isProcessing: boolean;
}

interface SRRevertFinalizeDialogProps {
    /** Controls the visibility of the dialog */
    open: boolean;
    /** Function to call when the dialog's open state should change */
    onOpenChange: (open: boolean) => void;
    /** The SR name (e.g., "SR-PROJ-00001") */
    srName: string | undefined;
    /** Function to execute when the user confirms revert */
    onConfirm: () => void;
    /** Flag indicating if the operation is in progress */
    isProcessing: boolean;
}

/**
 * Dialog for confirming Work Order finalization.
 * Shows which actions will be disabled after finalization.
 */
export const SRFinalizeDialog: React.FC<SRFinalizeDialogProps> = ({
    open,
    onOpenChange,
    srName,
    onConfirm,
    isProcessing,
}) => {
    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent className="sm:max-w-[425px]">
                <AlertDialogHeader className="text-center space-y-3">
                    {/* Lock Icon */}
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">
                        <Lock className="h-6 w-6 text-blue-600" aria-hidden="true" />
                    </div>

                    <AlertDialogTitle>Finalize Work Order?</AlertDialogTitle>

                    <AlertDialogDescription asChild>
                        <div className="text-sm text-gray-500 space-y-3">
                            <p>
                                Are you sure you want to finalize{' '}
                                <strong className="text-gray-700">{srName || 'this Work Order'}</strong>?
                            </p>

                            {/* Actions that will be disabled */}
                            <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-left">
                                <p className="font-medium text-amber-800 mb-2">
                                    The following actions will be disabled:
                                </p>
                                <ul className="list-disc list-inside space-y-1 text-amber-700 text-sm">
                                    <li>Amend Work Order</li>
                                    <li>Delete Work Order</li>
                                    <li>Edit Terms & Notes</li>
                                </ul>
                            </div>

                            {/* Warning */}
                            <div className="flex items-start gap-2 text-left">
                                <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
                                <p className="text-xs text-amber-600">
                                    Only administrators can revert this action later.
                                </p>
                            </div>
                        </div>
                    </AlertDialogDescription>
                </AlertDialogHeader>

                <AlertDialogFooter className="mt-4 flex flex-col-reverse sm:flex-row sm:justify-center sm:space-x-2 gap-2 sm:gap-0">
                    {isProcessing ? (
                        <div className="flex justify-center items-center w-full h-[40px]">
                            <TailSpin color="#2563eb" width={30} height={30} />
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
                                onClick={onConfirm}
                                disabled={isProcessing}
                                className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700"
                            >
                                <Lock className="h-4 w-4 mr-1" />
                                Finalize
                            </Button>
                        </>
                    )}
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};

/**
 * Dialog for confirming Work Order finalization revert.
 * Shows that editing and amendments will be allowed again.
 */
export const SRRevertFinalizeDialog: React.FC<SRRevertFinalizeDialogProps> = ({
    open,
    onOpenChange,
    srName,
    onConfirm,
    isProcessing,
}) => {
    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent className="sm:max-w-[425px]">
                <AlertDialogHeader className="text-center space-y-3">
                    {/* Unlock Icon */}
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100">
                        <Unlock className="h-6 w-6 text-amber-600" aria-hidden="true" />
                    </div>

                    <AlertDialogTitle>Revert Finalization?</AlertDialogTitle>

                    <AlertDialogDescription asChild>
                        <div className="text-sm text-gray-500 space-y-3">
                            <p>
                                Are you sure you want to revert finalization for{' '}
                                <strong className="text-gray-700">{srName || 'this Work Order'}</strong>?
                            </p>

                            {/* Info about what will happen */}
                            <div className="bg-blue-50 border border-blue-200 rounded-md p-3 text-left">
                                <p className="text-blue-700 text-sm">
                                    This will allow editing and amendments to the Work Order again.
                                </p>
                            </div>
                        </div>
                    </AlertDialogDescription>
                </AlertDialogHeader>

                <AlertDialogFooter className="mt-4 flex flex-col-reverse sm:flex-row sm:justify-center sm:space-x-2 gap-2 sm:gap-0">
                    {isProcessing ? (
                        <div className="flex justify-center items-center w-full h-[40px]">
                            <TailSpin color="#d97706" width={30} height={30} />
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
                                onClick={onConfirm}
                                disabled={isProcessing}
                                className="w-full sm:w-auto bg-amber-600 hover:bg-amber-700"
                            >
                                <Unlock className="h-4 w-4 mr-1" />
                                Revert
                            </Button>
                        </>
                    )}
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};
