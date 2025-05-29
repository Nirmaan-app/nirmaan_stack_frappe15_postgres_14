import React, { useEffect } from 'react';
import {
    AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogHeader, AlertDialogTitle, AlertDialogFooter
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TailSpin } from 'react-loader-spinner';
import { CustomAttachment } from '@/components/helpers/CustomAttachment';
import { useSRPaymentManager } from '../hooks/useSRPaymentManager';
import formatToIndianRupee, { formatToRoundedIndianRupee } from '@/utils/FormatPrice';
import { parseNumber } from '@/utils/parseNumber';
import { ServiceRequestsExtended } from '../hooks/useApprovedSRData';

interface SRNewPaymentDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    srDoc: ServiceRequestsExtended;
    totalPayable: number; // Total amount of the SR (e.g., inclusive of GST if applicable)
    alreadyPaid: number;
    onPaymentRecorded: () => void; // To trigger list refresh
}

export const SRNewPaymentDialog: React.FC<SRNewPaymentDialogProps> = ({
    isOpen,
    onOpenChange,
    srDoc,
    totalPayable,
    alreadyPaid,
    onPaymentRecorded,
}) => {
    const {
        paymentFormState,
        paymentScreenshot,
        paymentValidationWarning,
        isSubmittingPayment,
        handlePaymentInputChange,
        handlePaymentFileSelect,
        submitNewPayment,
        validatePaymentAmount,
        resetPaymentForm,
    } = useSRPaymentManager(srDoc, onPaymentRecorded);

    useEffect(() => {
        // Validate amount when it changes
        if (paymentFormState.amount) {
            validatePaymentAmount(paymentFormState.amount, totalPayable, alreadyPaid);
        } else {
            // Clear warning if amount is cleared by user
            handlePaymentInputChange("amount", ""); // This will trigger validation with 0
        }
    }, [paymentFormState.amount, totalPayable, alreadyPaid, validatePaymentAmount, handlePaymentInputChange]);
    
    const handleDialogClose = () => {
        resetPaymentForm();
        onOpenChange(false);
    };

    const handleConfirm = async () => {
        const success = await submitNewPayment(totalPayable, alreadyPaid);
        if (success) {
            handleDialogClose();
        }
    };
    
    const remainingPayable = Math.max(0, totalPayable - alreadyPaid);

    return (
        <AlertDialog open={isOpen} onOpenChange={(open) => { if (!open) handleDialogClose(); else onOpenChange(true);}}>
            <AlertDialogContent className="sm:max-w-lg">
                <AlertDialogHeader>
                    <AlertDialogTitle className="text-center">Record New Payment for SR: {srDoc.name}</AlertDialogTitle>
                    <AlertDialogDescription className="text-center text-xs">
                        Total SR Value: {formatToRoundedIndianRupee(totalPayable)} | Paid: {formatToRoundedIndianRupee(alreadyPaid)} |
                        <span className="font-semibold text-primary"> Remaining: {formatToRoundedIndianRupee(remainingPayable)}</span>
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="py-4 grid gap-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="amount" className="text-right col-span-1">Amount*</Label>
                        <Input id="amount" type="number" placeholder="0.00" value={paymentFormState.amount}
                               onChange={e => handlePaymentInputChange("amount", e.target.value)} className="col-span-3" />
                    </div>
                    {paymentValidationWarning && <p className="col-span-4 text-xs text-destructive text-center -mt-2">{paymentValidationWarning}</p>}

                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="tds" className="text-right col-span-1">TDS</Label>
                        <Input id="tds" type="number" placeholder="0.00" value={paymentFormState.tds}
                               onChange={e => handlePaymentInputChange("tds", e.target.value)} className="col-span-3" />
                    </div>
                     {parseNumber(paymentFormState.tds) > 0 && parseNumber(paymentFormState.amount) > 0 && (
                        <p className="col-span-4 text-xs text-muted-foreground text-right">
                            Net Payable to Vendor: {formatToRoundedIndianRupee(parseNumber(paymentFormState.amount) - parseNumber(paymentFormState.tds))}
                        </p>
                    )}

                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="utr" className="text-right col-span-1">UTR/Ref No.*</Label>
                        <Input id="utr" value={paymentFormState.utr}
                               onChange={e => handlePaymentInputChange("utr", e.target.value)} className="col-span-3" />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="payment_date" className="text-right col-span-1">Payment Date*</Label>
                        <Input id="payment_date" type="date" value={paymentFormState.payment_date}
                               onChange={e => handlePaymentInputChange("payment_date", e.target.value)}
                               max={new Date().toISOString().split("T")[0]} className="col-span-3" />
                    </div>
                    <CustomAttachment
                        maxFileSize={5 * 1024 * 1024} // 5MB example
                        selectedFile={paymentScreenshot}
                        onFileSelect={handlePaymentFileSelect}
                        label="Attach Payment Proof (Optional)"
                    />
                </div>
                <AlertDialogFooter>
                    <AlertDialogCancel onClick={handleDialogClose} disabled={isSubmittingPayment}>Cancel</AlertDialogCancel>
                    <Button onClick={handleConfirm} disabled={isSubmittingPayment || !paymentFormState.amount || !paymentFormState.utr || !paymentFormState.payment_date || (!!paymentValidationWarning && parseNumber(paymentFormState.amount) > 0) }>
                        {isSubmittingPayment ? <TailSpin color="#fff" height={20} width={20} /> : "Record Payment"}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};