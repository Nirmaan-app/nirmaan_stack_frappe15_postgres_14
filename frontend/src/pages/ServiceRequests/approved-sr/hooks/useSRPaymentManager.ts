import { useState, useCallback } from 'react';
import { useFrappeCreateDoc, useFrappeFileUpload, useFrappePostCall } from 'frappe-react-sdk';
import { toast } from '@/components/ui/use-toast';
import { parseNumber } from '@/utils/parseNumber';
import { NewPaymentFormState } from '../types'; // Local types
import { ServiceRequestsExtended } from './useApprovedSRData';
import { formatToRoundedIndianRupee } from '@/utils/FormatPrice';

const initialPaymentState: NewPaymentFormState = {
    amount: "",
    payment_date: new Date().toISOString().split("T")[0], // Default to today
    utr: "",
    tds: ""
};

export const useSRPaymentManager = (
    srDoc: ServiceRequestsExtended | undefined,
    mutatePaymentsList: () => void // To refresh the payments list for the SR
) => {
    const [formState, setFormState] = useState<NewPaymentFormState>(initialPaymentState);
    const [paymentScreenshot, setPaymentScreenshot] = useState<File | null>(null);
    const [validationWarning, setValidationWarning] = useState("");

    const { createDoc, loading: createPaymentLoading } = useFrappeCreateDoc();
    const { upload, loading: fileUploadLoading } = useFrappeFileUpload();
    const { call: setFileValueOnDoc, loading: setFileValueLoading } = useFrappePostCall('frappe.client.set_value');

    const isLoading = createPaymentLoading || fileUploadLoading || setFileValueLoading;

    const resetForm = useCallback(() => {
        setFormState(initialPaymentState);
        setPaymentScreenshot(null);
        setValidationWarning("");
    }, []);

    const handleInputChange = useCallback((field: keyof NewPaymentFormState, value: string) => {
        setFormState(prev => ({ ...prev, [field]: value }));
    }, []);

    const handleFileSelect = useCallback((file: File | null) => {
        setPaymentScreenshot(file);
    }, []);

    // Client-side validation (backend will also validate)
    const validatePaymentAmount = useCallback((amountStr: string, totalPayable: number, alreadyPaid: number) => {
        const amount = parseNumber(amountStr);
        const remaining = totalPayable - alreadyPaid;
        if (amount <= 0) {
            setValidationWarning("Amount must be greater than zero.");
            return false;
        }
        // Warning if exceeding remaining, but backend will be the final check
        if (amount > remaining && remaining > 0) {
            setValidationWarning(`Amount exceeds remaining payable (${formatToRoundedIndianRupee(remaining)}). Backend will validate.`);
        } else if (remaining <= 0 && amount > 0) {
             setValidationWarning(`No amount due or already overpaid. Backend will validate.`);
        }
         else {
            setValidationWarning("");
        }
        return true;
    }, []);


    const submitNewPayment = async (totalPayable: number, alreadyPaid: number) => {
        if (!srDoc) {
            toast({ title: "Error", description: "Service Request data not loaded.", variant: "destructive" });
            return;
        }
        if (!formState.amount || !formState.utr || !formState.payment_date) {
            toast({ title: "Missing Fields", description: "Amount, UTR, and Payment Date are required.", variant: "destructive" });
            return;
        }
        
        const requestedAmount = parseNumber(formState.amount);
        if (requestedAmount <= 0) {
             toast({ title: "Invalid Amount", description: "Amount must be positive.", variant: "destructive" });
            return;
        }
        // Client-side pre-check (backend does final validation)
        const maxAllowable = Math.max(0, totalPayable - alreadyPaid);
        if (requestedAmount > maxAllowable && maxAllowable > 0) {
            // Allow submission but rely on backend for strict check
            console.warn(`Client: Requested amount ${requestedAmount} exceeds max allowable ${maxAllowable}`);
        }


        try {
            const paymentDocPayload = {
                document_type: "Service Requests",
                document_name: srDoc.name,
                project: srDoc.project,
                vendor: srDoc.vendor,
                utr: formState.utr,
                amount: requestedAmount,
                tds: parseNumber(formState.tds) || undefined, // Send undefined if 0 or empty
                payment_date: formState.payment_date,
                status: "Paid" // Directly creating a "Paid" entry
            };

            const newPaymentDoc = await createDoc("Project Payments", paymentDocPayload);

            if (paymentScreenshot) {
                const fileArgs = {
                    doctype: "Project Payments",
                    docname: newPaymentDoc.name,
                    fieldname: "payment_attachment", // Ensure this field exists!
                    isPrivate: true,
                };
                const uploadedFile = await upload(paymentScreenshot, fileArgs);
                await setFileValueOnDoc({
                    doctype: "Project Payments",
                    name: newPaymentDoc.name,
                    fieldname: "payment_attachment",
                    value: uploadedFile.file_url,
                });
            }

            toast({ title: "Success", description: "Payment recorded successfully.", variant: "success" });
            resetForm();
            await mutatePaymentsList(); // Refresh the payments list
            return true;
        } catch (error: any) {
            let description = error.message || "Could not record payment.";
            if (error._server_messages) {
                 try { description = JSON.parse(error._server_messages)[0].message; } catch (e) {}
            }
            toast({ title: "Payment Failed", description, variant: "destructive" });
            return false;
        }
    };

    return {
        paymentFormState: formState,
        paymentScreenshot,
        paymentValidationWarning: validationWarning,
        isSubmittingPayment: isLoading,
        handlePaymentInputChange: handleInputChange,
        handlePaymentFileSelect: handleFileSelect,
        submitNewPayment,
        validatePaymentAmount, // Expose for on-the-fly validation UX
        resetPaymentForm: resetForm,
    };
};