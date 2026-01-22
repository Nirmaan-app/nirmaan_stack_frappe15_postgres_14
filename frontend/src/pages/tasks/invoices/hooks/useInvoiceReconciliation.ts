/**
 * Hook for managing invoice reconciliation.
 *
 * Updated to use invoice_id directly instead of (doctype, docname, date_key).
 */
import { useState, useCallback } from 'react';
import { useFrappePostCall, useFrappeFileUpload } from 'frappe-react-sdk';
import { useToast } from "@/components/ui/use-toast";
import { API_UPDATE_INVOICE_RECONCILIATION, ReconciliationStatus, VENDOR_INVOICES_DOCTYPE } from '../constants';

interface ReconciliationDialogState {
    isOpen: boolean;
    invoiceId: string | null;
    invoiceNo: string | null;
    documentType: "Procurement Orders" | "Service Requests" | null;
    documentName: string | null;
    currentReconciliationStatus: ReconciliationStatus;
    currentReconciledDate: string | null;
    currentProofAttachmentUrl: string | null;
    currentInvoiceAmount: number;
    currentReconciledAmount: number | null;
    /** @deprecated Use invoiceId instead */
    dateKey?: string | null;
    /** @deprecated Use documentType instead */
    doctype?: "Procurement Orders" | "Service Requests" | null;
    /** @deprecated Use documentName instead */
    docname?: string | null;
}

const initialDialogState: ReconciliationDialogState = {
    isOpen: false,
    invoiceId: null,
    invoiceNo: null,
    documentType: null,
    documentName: null,
    currentReconciliationStatus: "",
    currentReconciledDate: null,
    currentProofAttachmentUrl: null,
    currentInvoiceAmount: 0,
    currentReconciledAmount: null,
};

interface InvoiceForReconciliation {
    /** Vendor Invoice ID (name) */
    name?: string;
    /** @deprecated Use name instead */
    procurement_order?: string;
    /** @deprecated Use name instead */
    service_request?: string;
    /** @deprecated Not needed with Vendor Invoices */
    date?: string;
    invoice_no: string;
    amount: number;
    reconciliation_status?: ReconciliationStatus;
    reconciled_date?: string | null;
    reconciliation_proof_attachment_id?: string | null;
    reconciled_amount?: number | null;
    /** Document type for display purposes */
    document_type?: "Procurement Orders" | "Service Requests";
    document_name?: string;
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
        // Determine the invoice ID
        let invoiceId = invoice.name;
        let documentType: "Procurement Orders" | "Service Requests" = invoiceType === 'po' ? "Procurement Orders" : "Service Requests";
        let documentName = invoice.document_name || (invoiceType === 'po' ? invoice.procurement_order : invoice.service_request);

        if (!invoiceId) {
            // Backward compatibility: if no invoice name, we'll use the old parameters
            // The backend API supports both
            toast({
                title: "Warning",
                description: "Using legacy invoice reference. Consider updating the data.",
                variant: "default",
            });
        }

        // Get the existing proof attachment URL if available
        let proofAttachmentUrl: string | null = null;
        if (invoice.reconciliation_proof_attachment_id && getAttachmentUrl) {
            proofAttachmentUrl = getAttachmentUrl(invoice.reconciliation_proof_attachment_id) || null;
        }

        setDialogState({
            isOpen: true,
            invoiceId: invoiceId || null,
            invoiceNo: invoice.invoice_no,
            documentType,
            documentName: documentName || null,
            currentReconciliationStatus: invoice.reconciliation_status || "",
            currentReconciledDate: invoice.reconciled_date || null,
            currentProofAttachmentUrl: proofAttachmentUrl,
            currentInvoiceAmount: invoice.amount,
            currentReconciledAmount: invoice.reconciled_amount ?? null,
            // Legacy fields for backward compatibility
            dateKey: invoice.date || null,
            doctype: documentType,
            docname: documentName || null,
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

    // Update reconciliation status
    const updateReconciliation = useCallback(async (
        reconciliationStatus: ReconciliationStatus,
        reconciledDate: string | null,
        proofFile: File | null,
        reconciledAmount: number | null
    ) => {
        // Validate we have enough info to proceed
        if (!dialogState.invoiceId && (!dialogState.documentType || !dialogState.documentName || !dialogState.dateKey)) {
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
                // Upload to Vendor Invoices doctype if we have invoice_id
                const uploadDoctype = dialogState.invoiceId ? VENDOR_INVOICES_DOCTYPE : dialogState.documentType!;
                const uploadDocname = dialogState.invoiceId || dialogState.documentName!;

                proofUrl = await uploadProofFile(proofFile, uploadDoctype, uploadDocname);
                if (!proofUrl) {
                    setIsProcessing(false);
                    return;
                }
            }

            // Build API parameters
            const apiParams: Record<string, any> = {
                reconciliation_status: reconciliationStatus,
                reconciled_date: reconciledDate,
                reconciliation_proof_url: proofUrl,
                reconciled_amount: reconciledAmount,
            };

            // Use invoice_id if available (preferred), otherwise fall back to legacy params
            if (dialogState.invoiceId) {
                apiParams.invoice_id = dialogState.invoiceId;
            } else {
                apiParams.doctype = dialogState.documentType;
                apiParams.docname = dialogState.documentName;
                apiParams.date_key = dialogState.dateKey;
            }

            const response = await updateReconciliationApi(apiParams);

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
