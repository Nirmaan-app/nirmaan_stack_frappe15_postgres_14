import { useState, useCallback } from 'react';
import { useFrappePostCall } from 'frappe-react-sdk';
import { useToast } from "@/components/ui/use-toast";
import { API_UPDATE_INVOICE_RECONCILIATION } from '../constants';

interface ReconciliationDialogState {
    isOpen: boolean;
    doctype: "Procurement Orders" | "Service Requests" | null;
    docname: string | null;
    dateKey: string | null;
    invoiceNo: string | null;
    currentIs2bActivated: boolean;
    currentReconciledDate: string | null;
}

const initialDialogState: ReconciliationDialogState = {
    isOpen: false,
    doctype: null,
    docname: null,
    dateKey: null,
    invoiceNo: null,
    currentIs2bActivated: false,
    currentReconciledDate: null,
};

interface InvoiceForReconciliation {
    procurement_order?: string;
    service_request?: string;
    date: string;
    invoice_no: string;
    is_2b_activated?: boolean;
    reconciled_date?: string | null;
}

interface UseInvoiceReconciliationProps {
    onSuccess?: () => void;
    invoiceType: 'po' | 'sr';
}

export const useInvoiceReconciliation = ({ onSuccess, invoiceType }: UseInvoiceReconciliationProps) => {
    const { toast } = useToast();
    const [dialogState, setDialogState] = useState<ReconciliationDialogState>(initialDialogState);
    const [isProcessing, setIsProcessing] = useState(false);

    const { call: updateReconciliationApi } = useFrappePostCall(API_UPDATE_INVOICE_RECONCILIATION);

    // Open the reconciliation dialog for a specific invoice
    const openReconciliationDialog = useCallback((invoice: InvoiceForReconciliation) => {
        const doctype = invoiceType === 'po' ? "Procurement Orders" : "Service Requests";
        const docname = invoiceType === 'po' ? invoice.procurement_order : invoice.service_request;

        if (!docname) {
            toast({
                title: "Error",
                description: "Could not identify the document.",
                variant: "destructive",
            });
            return;
        }

        setDialogState({
            isOpen: true,
            doctype,
            docname,
            dateKey: invoice.date,
            invoiceNo: invoice.invoice_no,
            currentIs2bActivated: invoice.is_2b_activated || false,
            currentReconciledDate: invoice.reconciled_date || null,
        });
    }, [invoiceType, toast]);

    // Close the dialog
    const closeDialog = useCallback(() => {
        if (isProcessing) return;
        setDialogState(initialDialogState);
    }, [isProcessing]);

    // Update reconciliation status (called from dialog confirm)
    const updateReconciliation = useCallback(async (
        is2bActivated: boolean,
        reconciledDate: string | null
    ) => {
        if (!dialogState.doctype || !dialogState.docname || !dialogState.dateKey) {
            toast({
                title: "Error",
                description: "Missing required information.",
                variant: "destructive",
            });
            return;
        }

        setIsProcessing(true);

        try {
            const response = await updateReconciliationApi({
                doctype: dialogState.doctype,
                docname: dialogState.docname,
                date_key: dialogState.dateKey,
                is_2b_activated: is2bActivated,
                reconciled_date: reconciledDate,
            });

            if (response.message?.status === 200) {
                toast({
                    title: "Success",
                    description: is2bActivated
                        ? `Invoice marked as 2B activated (${reconciledDate}).`
                        : "Invoice 2B activation removed.",
                    variant: "success",
                });

                if (onSuccess) {
                    onSuccess();
                }

                closeDialog();
            } else {
                throw new Error(response.message?.message || "Failed to update reconciliation status.");
            }
        } catch (error) {
            console.error("Error updating reconciliation:", error);
            toast({
                title: "Error",
                description: error instanceof Error ? error.message : "An unexpected error occurred.",
                variant: "destructive",
            });
        } finally {
            setIsProcessing(false);
        }
    }, [dialogState, updateReconciliationApi, toast, onSuccess, closeDialog]);

    return {
        dialogState,
        openReconciliationDialog,
        closeDialog,
        updateReconciliation,
        isProcessing,
    };
};
