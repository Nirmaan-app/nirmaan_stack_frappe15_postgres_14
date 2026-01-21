import { useState, useCallback } from 'react';
import { useFrappePostCall, useFrappeFileUpload } from 'frappe-react-sdk';
import { useToast } from "@/components/ui/use-toast";
import { API_UPDATE_INVOICE_RECONCILIATION, ReconciliationStatus } from '../constants';

interface ReconciliationDialogState {
    isOpen: boolean;
    doctype: "Procurement Orders" | "Service Requests" | null;
    docname: string | null;
    dateKey: string | null;
    invoiceNo: string | null;
    currentReconciliationStatus: ReconciliationStatus;
    currentReconciledDate: string | null;
    currentProofAttachmentUrl: string | null;
    currentInvoiceAmount: number;
    currentReconciledAmount: number | null;
}

const initialDialogState: ReconciliationDialogState = {
    isOpen: false,
    doctype: null,
    docname: null,
    dateKey: null,
    invoiceNo: null,
    currentReconciliationStatus: "",
    currentReconciledDate: null,
    currentProofAttachmentUrl: null,
    currentInvoiceAmount: 0,
    currentReconciledAmount: null,
};

interface InvoiceForReconciliation {
    procurement_order?: string;
    service_request?: string;
    date: string;
    invoice_no: string;
    amount: number;
    reconciliation_status?: ReconciliationStatus;
    reconciled_date?: string | null;
    reconciliation_proof_attachment_id?: string | null;
    reconciled_amount?: number | null;
}

interface UseInvoiceReconciliationProps {
    onSuccess?: () => void;
    invoiceType: 'po' | 'sr';
    getAttachmentUrl?: (attachmentId: string) => string | undefined;
}

export const useInvoiceReconciliation = ({
    onSuccess,
    invoiceType,
    getAttachmentUrl,
}: UseInvoiceReconciliationProps) => {
    const { toast } = useToast();
    const [dialogState, setDialogState] = useState<ReconciliationDialogState>(initialDialogState);
    const [isProcessing, setIsProcessing] = useState(false);

    const { call: updateReconciliationApi } = useFrappePostCall(API_UPDATE_INVOICE_RECONCILIATION);
    const { upload } = useFrappeFileUpload();

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

        // Get the existing proof attachment URL if available
        let proofAttachmentUrl: string | null = null;
        if (invoice.reconciliation_proof_attachment_id && getAttachmentUrl) {
            proofAttachmentUrl = getAttachmentUrl(invoice.reconciliation_proof_attachment_id) || null;
        }

        setDialogState({
            isOpen: true,
            doctype,
            docname,
            dateKey: invoice.date,
            invoiceNo: invoice.invoice_no,
            currentReconciliationStatus: invoice.reconciliation_status || "",
            currentReconciledDate: invoice.reconciled_date || null,
            currentProofAttachmentUrl: proofAttachmentUrl,
            currentInvoiceAmount: invoice.amount,
            currentReconciledAmount: invoice.reconciled_amount ?? null,
        });
    }, [invoiceType, toast, getAttachmentUrl]);

    // Close the dialog
    const closeDialog = useCallback(() => {
        if (isProcessing) return;
        setDialogState(initialDialogState);
    }, [isProcessing]);

    // Upload proof file and return URL
    const uploadProofFile = useCallback(async (
        file: File,
        doctype: string,
        docname: string
    ): Promise<string | null> => {
        try {
            const result = await upload(file, {
                doctype,
                docname,
                fieldname: "attachment",
                isPrivate: true
            });
            return result.file_url;
        } catch (error) {
            console.error("Error uploading proof file:", error);
            toast({
                title: "Upload Failed",
                description: "Failed to upload reconciliation proof attachment.",
                variant: "destructive",
            });
            return null;
        }
    }, [upload, toast]);

    // Update reconciliation status (called from dialog confirm)
    const updateReconciliation = useCallback(async (
        reconciliationStatus: ReconciliationStatus,
        reconciledDate: string | null,
        proofFile: File | null,
        reconciledAmount: number | null
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
            // Upload proof file if provided
            let proofUrl: string | null = null;
            const isReconciled = reconciliationStatus === "partial" || reconciliationStatus === "full";

            if (isReconciled && proofFile) {
                proofUrl = await uploadProofFile(
                    proofFile,
                    dialogState.doctype,
                    dialogState.docname
                );
                if (!proofUrl) {
                    // Upload failed, error already shown
                    setIsProcessing(false);
                    return;
                }
            }

            // Call the API
            const response = await updateReconciliationApi({
                doctype: dialogState.doctype,
                docname: dialogState.docname,
                date_key: dialogState.dateKey,
                reconciliation_status: reconciliationStatus,
                reconciled_date: reconciledDate,
                reconciliation_proof_url: proofUrl,
                reconciled_amount: reconciledAmount,
            });

            if (response.message?.status === 200) {
                const statusLabels: Record<ReconciliationStatus, string> = {
                    "": "Not Reconciled",
                    "partial": "Partially Reconciled",
                    "full": "Fully Reconciled",
                    "na": "Not Applicable",
                };

                toast({
                    title: "Success",
                    description: `Invoice marked as ${statusLabels[reconciliationStatus]}${reconciledDate ? ` (${reconciledDate})` : ""}.`,
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
    }, [dialogState, updateReconciliationApi, uploadProofFile, toast, onSuccess, closeDialog]);

    return {
        dialogState,
        openReconciliationDialog,
        closeDialog,
        updateReconciliation,
        isProcessing,
    };
};
