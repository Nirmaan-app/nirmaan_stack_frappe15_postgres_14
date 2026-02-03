import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useFrappePostCall } from 'frappe-react-sdk';
import { ServiceRequests } from '@/types/NirmaanStack/ServiceRequests';
import formatToIndianRupee, { formatToRoundedIndianRupee } from '@/utils/FormatPrice';
import { parseNumber } from '@/utils/parseNumber';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from '@/components/ui/use-toast';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { TailSpin } from 'react-loader-spinner';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radiogroup';
import { useCEOHoldGuard } from '@/hooks/useCEOHoldGuard';

interface SRRequestPaymentDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    srDoc: ServiceRequests;
    totalSrAmountInclGST: number;
    totalSrAmountExclGST: number; // If needed for "without GST" option
    currentPaidAmount: number;
    currentPendingAmount: number; // Other pending requests
    onPaymentRequested: () => void;
}

export const SRRequestPaymentDialog: React.FC<SRRequestPaymentDialogProps> = ({
    isOpen,
    onOpenChange,
    srDoc,
    totalSrAmountInclGST,
    totalSrAmountExclGST,
    currentPaidAmount,
    currentPendingAmount,
    onPaymentRequested,
}) => {
    const [selectedOption, setSelectedOption] = useState<string>("custom");
    const [customAmountInput, setCustomAmountInput] = useState<string>("");
    const [percentageInput, setPercentageInput] = useState<string>("");
    const [effectiveAmountRequesting, setEffectiveAmountRequesting] = useState<number>(0);
    const [validationWarning, setValidationWarning] = useState<string>("");

    const gstApplicableOnSR = srDoc.gst === "true";
    const baseAmountForPayment = gstApplicableOnSR ? totalSrAmountInclGST : totalSrAmountExclGST;

    // CEO Hold guard
    const { isCEOHold, showBlockedToast } = useCEOHoldGuard(srDoc.project);

    const maxPossibleNewRequest = useMemo(() =>
        Math.max(0, baseAmountForPayment - currentPaidAmount - currentPendingAmount),
    [baseAmountForPayment, currentPaidAmount, currentPendingAmount]);

    const { call: createPaymentRequestAPI, loading: isSubmitting } = useFrappePostCall(
        'your_app_name.api.payment_requests.create_payment_request' // Path to your generic backend API
    );

    // Calculate effective amount (Similar to your RequestPaymentDialog for POs)
    useEffect(() => {
        let calculatedAmount = 0;
        switch (selectedOption) {
            case "full": calculatedAmount = maxPossibleNewRequest; break;
            case "withoutGST": // This applies if SR total can be considered w/o GST
                calculatedAmount = Math.min(maxPossibleNewRequest, totalSrAmountExclGST - currentPaidAmount - currentPendingAmount);
                break;
            case "due": calculatedAmount = maxPossibleNewRequest; break;
            case "custom": calculatedAmount = parseNumber(customAmountInput); break;
            case "percentage":
                const perc = parseNumber(percentageInput);
                calculatedAmount = (baseAmountForPayment * perc) / 100;
                break;
            default: calculatedAmount = 0;
        }
        setEffectiveAmountRequesting(Math.max(0, calculatedAmount));
    }, [selectedOption, customAmountInput, percentageInput, maxPossibleNewRequest, baseAmountForPayment, totalSrAmountExclGST, currentPaidAmount, currentPendingAmount]);

    // Client-side validation (Similar to your RequestPaymentDialog for POs)
    const validateClientSide = useCallback( /* ... same debounce logic ... */ (amount: number) => {
        if (amount > maxPossibleNewRequest) { setValidationWarning(`Requested (${formatToRoundedIndianRupee(amount)}) exceeds max allowable (${formatToRoundedIndianRupee(maxPossibleNewRequest)}).`); }
        else if (amount <= 0 && selectedOption) { setValidationWarning("Amount must be > 0."); }
        else { setValidationWarning(""); }
    }, [maxPossibleNewRequest]);

    useEffect(() => { /* ... same effect to call validateClientSide ... */
        if (effectiveAmountRequesting > 0 || selectedOption) validateClientSide(effectiveAmountRequesting);
        else setValidationWarning("");
    }, [effectiveAmountRequesting, selectedOption, validateClientSide]);


    const handleSubmitRequest = async () => {
        if (isCEOHold) {
            showBlockedToast();
            return;
        }
        // ... (validation checks for warning or amount <= 0)
        if (validationWarning || effectiveAmountRequesting <= 0) { /* ... toast error ... */ return; }

        try {
            const response = await createPaymentRequestAPI({
                document_type: "Service Requests",
                document_name: srDoc.name,
                requested_amount_str: String(effectiveAmountRequesting.toFixed(2)),
                payment_option_type: selectedOption,
                payment_option_value: selectedOption === 'custom' ? customAmountInput : selectedOption === 'percentage' ? percentageInput : undefined,
            });
            if (response.message?.status === "success") { /* ... toast success, close, callback ... */
                toast({ title: "Success", description: response.message.message || "Payment requested.", variant: "success"});
                onOpenChange(false); onPaymentRequested(); resetForm();
            } else { /* ... toast backend error ... */ 
                 toast({ title: response.message?.title || "Request Failed", description: response.message?.message || "Could not request payment.", variant: "destructive" });
            }
        } catch (error: any) { /* ... toast submission error ... */
            let desc = error.message || "Unexpected error."; if (error._server_messages) { try { desc = JSON.parse(error._server_messages)[0].message; } catch(e){} }
            toast({ title: "Error", description: desc, variant: "destructive" });
        }
    };
    
    const resetForm = () => { /* ... reset local states ... */ setSelectedOption("custom"); setCustomAmountInput(""); setPercentageInput("");};
    const dueAmountDisplay = maxPossibleNewRequest;


    return (
        <AlertDialog open={isOpen} onOpenChange={(open) => { if (!open) resetForm(); onOpenChange(open);}}>
            <AlertDialogContent className="sm:max-w-md">
                <AlertDialogHeader>
                    <AlertDialogTitle className="text-center">Request Payment for SR: {srDoc.name}</AlertDialogTitle>
                    <AlertDialogDescription className="text-center text-xs">
                         Base Value: {formatToRoundedIndianRupee(baseAmountForPayment)} | Paid: {formatToRoundedIndianRupee(currentPaidAmount)} | Pending: {formatToRoundedIndianRupee(currentPendingAmount)} |
                        <span className="font-semibold text-primary"> Max New Req: {formatToRoundedIndianRupee(maxPossibleNewRequest)}</span>
                    </AlertDialogDescription>
                </AlertDialogHeader>
                {/* RadioGroup and Inputs similar to your original RequestPaymentDialog, adapted for SR */}
                <RadioGroup className="space-y-3 pt-2" onValueChange={setSelectedOption} value={selectedOption}>
                    {/* Custom Amount */}
                    <div>
                        <div className="flex items-center space-x-2">
                        <RadioGroupItem value="custom" id={`sr_customRadio_${srDoc.name}`} />
                        <Label htmlFor={`sr_customRadio_${srDoc.name}`} className="flex-1 cursor-pointer">Custom Amount</Label>
                        <Input type="number" className="w-28 h-8" disabled={selectedOption !== "custom"} value={customAmountInput} onChange={(e) => setCustomAmountInput(e.target.value)} placeholder="Enter amount"/>
                        </div>
                    </div>
                    {/* Conditional Options */}
                    {(currentPaidAmount <= 0 && currentPendingAmount <= 0) && (
                        <>
                        <div className="flex items-center space-x-2">
                            <RadioGroupItem value="percentage" id={`sr_percentageRadio_${srDoc.name}`} />
                            <Input type="number" className="w-20 h-8" disabled={selectedOption !== "percentage"} value={percentageInput} onChange={(e) => setPercentageInput(e.target.value)} placeholder="e.g., 50"/>
                            <Label htmlFor={`sr_percentageRadio_${srDoc.name}`} className="cursor-pointer">% of Total</Label>
                        </div>
                        {gstApplicableOnSR && totalSrAmountExclGST < totalSrAmountInclGST && (
                            <div className="flex items-center space-x-2">
                                <RadioGroupItem value="withoutGST" id={`sr_withoutGSTRadio_${srDoc.name}`} />
                                <Label htmlFor={`sr_withoutGSTRadio_${srDoc.name}`} className="cursor-pointer">Total (Excl. GST: {formatToRoundedIndianRupee(totalSrAmountExclGST)})</Label>
                            </div>
                        )}
                        <div className="flex items-center space-x-2">
                            <RadioGroupItem value="full" id={`sr_fullRadio_${srDoc.name}`} />
                            <Label htmlFor={`sr_fullRadio_${srDoc.name}`} className="cursor-pointer">Full Remaining Amount</Label>
                        </div>
                        </>
                    )}
                    {(currentPaidAmount > 0 || currentPendingAmount > 0) && dueAmountDisplay > 0 && (
                        <div className="flex items-center space-x-2">
                            <RadioGroupItem value="due" id={`sr_dueRadio_${srDoc.name}`} />
                            <Label htmlFor={`sr_dueRadio_${srDoc.name}`} className="cursor-pointer">Outstanding Due: {formatToRoundedIndianRupee(dueAmountDisplay)}</Label>
                        </div>
                    )}
                </RadioGroup>
                {validationWarning && <p className="text-red-500 text-xs whitespace-pre-wrap mt-2 p-2 bg-red-50 border border-red-200 rounded">{validationWarning}</p>}
                <div className="mt-4 text-center font-semibold text-lg">Requesting: <span className="text-primary">{formatToRoundedIndianRupee(effectiveAmountRequesting)}</span></div>
                <AlertDialogFooter className="mt-4">
                    <AlertDialogCancel onClick={() => { resetForm(); onOpenChange(false);}} disabled={isSubmitting}>Cancel</AlertDialogCancel>
                    <Button onClick={handleSubmitRequest} disabled={isSubmitting || effectiveAmountRequesting <= 0 || !!validationWarning}>
                        {isSubmitting ? <TailSpin color="#fff" height={20} width={20} /> : "Submit Request"}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};