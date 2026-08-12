import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments"; // Assuming type path
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { parseNumber } from "@/utils/parseNumber";
import { TailSpin } from 'react-loader-spinner';
import { DIALOG_ACTION_TYPES, DialogActionType } from '../constants';
import { computeSplit, isAmountKeystroke, isSplittable } from '../paymentSplit';

interface PaymentActionDialogProps {
    isOpen: boolean;
    onOpenChange: (isOpen: boolean) => void;
    type: DialogActionType;
    paymentData: ProjectPayments | null;
    vendorName?: string; // Pass pre-fetched vendor name
    onSubmit: (actionType: DialogActionType, amount: number) => Promise<void>; // onSubmit now handles the async logic
    isLoading: boolean; // Loading state passed from parent
    /**
     * Let the approver approve LESS than was requested (the CEO gate).
     *
     * The balance is never discarded — the backend splits the payment, leaving the difference as
     * its own pending payment plus its own PO term row. The dialog says so explicitly, because
     * "approve 3 of 5" reads like "reject 2" unless the screen states otherwise.
     */
    allowPartial?: boolean;
}

export const PaymentActionDialog: React.FC<PaymentActionDialogProps> = ({
    isOpen,
    onOpenChange,
    type,
    paymentData,
    vendorName = "the vendor", // Default text
    onSubmit,
    isLoading,
    allowPartial = false,
}) => {
    const [amountInput, setAmountInput] = useState<string>("");

    const requestedAmount = parseNumber(paymentData?.amount);
    // `isSplittable` is what keeps a REFUND approvable. A negative payment (a credit raised after
    // a negative-rate amendment) cannot be split, and showing the amount box on one leaves the
    // Confirm button permanently disabled. Unsplittable => the plain full-approve confirmation,
    // byte-identical to the pre-partial-approval behaviour.
    const isPartialApprove =
        allowPartial && type === DIALOG_ACTION_TYPES.APPROVE && isSplittable(requestedAmount);

    // Reset amount input when payment data changes or dialog opens/closes
    useEffect(() => {
        if (paymentData) {
            setAmountInput(String(paymentData.amount || ""));
        } else {
            setAmountInput(""); // Clear if no data
        }
    }, [paymentData, isOpen]); // Depend on isOpen to reset on reopen

    // All the boundary rules live in the pure helper so they can be tested — there is no DOM
    // test environment in this repo, so anything decided inline here would be untestable.
    const split = useMemo(
        () => computeSplit(requestedAmount, amountInput),
        [requestedAmount, amountInput]
    );

    const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (isAmountKeystroke(e.target.value)) {
            setAmountInput(e.target.value);
        }
    };

    const handleConfirm = useCallback(async () => {
        if (!paymentData) return;
        if (isPartialApprove && !split.valid) return;

        // Non-partial paths send the untouched requested amount, exactly as before.
        await onSubmit(type, isPartialApprove ? split.approved : requestedAmount);
        // Parent component will handle closing the dialog via onOpenChange after successful submission if needed

    }, [paymentData, type, isPartialApprove, split, requestedAmount, onSubmit]);

    const renderTitle = () => {
        if (!paymentData) return null;

        if (isPartialApprove) {
            // The amount is editable here, so the title must NOT assert it — the figure being
            // approved is whatever is in the box, and it is shown next to the box.
            return (
                <>
                    Approve payment to <span className="font-semibold">{vendorName}</span> for{' '}
                    <i>#{paymentData.document_name}</i>
                </>
            );
        }

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

                {isPartialApprove && paymentData && (
                    <div className="space-y-3">
                        <div className="flex items-baseline justify-between text-sm">
                            <span className="text-muted-foreground">Requested</span>
                            <span className="font-medium tabular-nums">
                                {formatToRoundedIndianRupee(requestedAmount)}
                            </span>
                        </div>

                        <div className="space-y-1.5">
                            <label htmlFor="approved-amount" className="text-sm font-medium">
                                Approving now
                            </label>
                            <Input
                                id="approved-amount"
                                type="text" // Use text to allow decimal input easily, validation handles numeric check
                                inputMode="decimal" // Hint for mobile keyboards
                                onChange={handleAmountChange}
                                value={amountInput}
                                className="h-9 text-right tabular-nums"
                                disabled={isLoading}
                                aria-invalid={!split.valid}
                                aria-describedby="approved-amount-help"
                            />
                            <p id="approved-amount-help" className="text-xs">
                                {!split.valid ? (
                                    <span className="text-destructive">{split.reason}</span>
                                ) : split.isPartial ? (
                                    <span className="text-amber-700 dark:text-amber-400">
                                        The balance of{' '}
                                        <span className="font-semibold tabular-nums">
                                            {formatToRoundedIndianRupee(split.remainder)}
                                        </span>{' '}
                                        stays pending as a new payment, and is added to{' '}
                                        <i>#{paymentData.document_name}</i> as a separate payment term.
                                        Nothing is written off.
                                    </span>
                                ) : (
                                    <span className="text-muted-foreground">
                                        Approving the full requested amount.
                                    </span>
                                )}
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
                                disabled={isLoading || (isPartialApprove && !split.valid)}
                                onClick={handleConfirm}
                            >
                                {isPartialApprove && split.valid && split.isPartial
                                    ? `Approve ${formatToRoundedIndianRupee(split.approved)}`
                                    : `Confirm ${type}`}
                            </Button>
                        </>
                    )}
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};
