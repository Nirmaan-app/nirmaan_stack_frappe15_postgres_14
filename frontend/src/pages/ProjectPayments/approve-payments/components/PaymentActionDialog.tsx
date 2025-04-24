import React, { useState, useEffect, useCallback } from 'react';
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogFooter, // Use Footer for better layout
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments"; // Assuming type path
import formatToIndianRupee, { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { parseNumber } from "@/utils/parseNumber";
import { TailSpin } from 'react-loader-spinner';
import { DIALOG_ACTION_TYPES, DialogActionType } from '../constants';

interface PaymentActionDialogProps {
    isOpen: boolean;
    onOpenChange: (isOpen: boolean) => void;
    type: DialogActionType;
    paymentData: ProjectPayments | null;
    vendorName?: string; // Pass pre-fetched vendor name
    onSubmit: (actionType: DialogActionType, amount: number) => Promise<void>; // onSubmit now handles the async logic
    isLoading: boolean; // Loading state passed from parent
}

export const PaymentActionDialog: React.FC<PaymentActionDialogProps> = ({
    isOpen,
    onOpenChange,
    type,
    paymentData,
    vendorName = "the vendor", // Default text
    onSubmit,
    isLoading,
}) => {
    const [amountInput, setAmountInput] = useState<string>("");
    const { toast } = useToast();

    // Reset amount input when payment data changes or dialog opens/closes
    useEffect(() => {
        if (paymentData) {
            setAmountInput(String(paymentData.amount || ""));
        } else {
            setAmountInput(""); // Clear if no data
        }
    }, [paymentData, isOpen]); // Depend on isOpen to reset on reopen

    const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        // Allow only numbers and a single decimal point
        const value = e.target.value;
        if (/^\d*\.?\d*$/.test(value) || value === "") {
            setAmountInput(value);
        }
    };

    const handleConfirm = useCallback(async () => {
        if (!paymentData) return;

        const finalAmount = type === DIALOG_ACTION_TYPES.EDIT ? parseNumber(amountInput) : parseNumber(paymentData.amount);

        if (type === DIALOG_ACTION_TYPES.EDIT && (isNaN(finalAmount) || finalAmount <= 0)) {
            toast({
                title: "Invalid Amount",
                description: "Please enter a valid positive amount.",
                variant: "destructive",
            });
            return;
        }

        // Call the onSubmit prop which contains the updateDoc logic
        await onSubmit(type, finalAmount);
        // Parent component will handle closing the dialog via onOpenChange after successful submission if needed

    }, [paymentData, type, amountInput, onSubmit, toast]);

    const renderTitle = () => {
        if (!paymentData) return null;

        switch (type) {
            case DIALOG_ACTION_TYPES.APPROVE:
            case DIALOG_ACTION_TYPES.REJECT:
                return (
                    <>
                        Are you sure you want to {type} the payment of{' '}
                        <span className="font-semibold text-primary">{formatToRoundedIndianRupee(paymentData.amount)}</span> to{' '}
                        <span className="font-semibold">{vendorName}</span> for{' '}
                        <i>#{paymentData.document_name}</i>?
                    </>
                );
            case DIALOG_ACTION_TYPES.EDIT:
                return "Edit & Approve Payment";
            default:
                return "Confirm Action";
        }
    };

    return (
        <AlertDialog open={isOpen} onOpenChange={onOpenChange}>
            <AlertDialogContent className="sm:max-w-md">
                <AlertDialogHeader>
                    <AlertDialogTitle className="text-center sm:text-left">
                        {renderTitle()}
                    </AlertDialogTitle>
                </AlertDialogHeader>

                {type === DIALOG_ACTION_TYPES.EDIT && paymentData && (
                    <div className="grid grid-cols-3 gap-4 items-start ">
                        <label htmlFor="amount" className="text-sm font-medium text-right col-span-1">
                            Amount:
                        </label>
                        <div className="col-span-2">
                            <Input
                                id="amount"
                                type="text" // Use text to allow decimal input easily, validation handles numeric check
                                inputMode="decimal" // Hint for mobile keyboards
                                onChange={handleAmountChange}
                                value={amountInput}
                                className="h-9"
                                disabled={isLoading}
                            />
                             <p className="text-xs mt-1.5 text-gray-600">
                                For: <span className="font-medium">{vendorName}</span>
                                <br/>Ref: <i>#{paymentData.document_name}</i>
                            </p>
                        </div>
                    </div>
                )}

                <AlertDialogFooter className="mt-4">
                    {isLoading ? (
                        <div className="flex justify-center w-full">
                            <TailSpin width={30} height={30} color="red" />
                        </div>
                    ) : (
                        <>
                            <AlertDialogCancel disabled={isLoading}>Cancel</AlertDialogCancel>
                            <Button
                                disabled={isLoading || (type === DIALOG_ACTION_TYPES.EDIT && !amountInput)}
                                onClick={handleConfirm}
                            >
                                Confirm {type === DIALOG_ACTION_TYPES.EDIT ? 'and Approve' : type}
                            </Button>
                        </>
                    )}
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};