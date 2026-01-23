/**
 * Hook for approving/rejecting vendor invoices.
 *
 * Updated to use the new API_APPROVE_VENDOR_INVOICE endpoint.
 */
import { useState, useCallback } from 'react';
import { useFrappePostCall } from 'frappe-react-sdk';
import { useToast } from "@/components/ui/use-toast";
import { API_APPROVE_VENDOR_INVOICE } from '../constants';
import { VendorInvoice } from '@/types/NirmaanStack/VendorInvoice';

interface ConfirmationState {
    isOpen: boolean;
    invoiceId: string | null;
    invoiceNo?: string | null;
    action: "Approved" | "Rejected" | null;
}

const initialConfirmationState: ConfirmationState = {
    isOpen: false,
    invoiceId: null,
    invoiceNo: null,
    action: null,
};

interface UseInvoiceActionsProps {
    onActionSuccess?: () => void;
}

export const useInvoiceTaskActions = ({ onActionSuccess }: UseInvoiceActionsProps = {}) => {
    const { toast } = useToast();
    const [confirmationState, setConfirmationState] = useState<ConfirmationState>(initialConfirmationState);
    const [loadingInvoiceId, setLoadingInvoiceId] = useState<string | null>(null);

    const { call: approveInvoiceApi, loading: isApiLoading } = useFrappePostCall(API_APPROVE_VENDOR_INVOICE);

    const handleUpdateInvoiceStatus = useCallback(async (
        invoiceId: string,
        newStatus: "Approved" | "Rejected",
        rejectionReason?: string
    ) => {
        setLoadingInvoiceId(invoiceId);
        try {
            const response = await approveInvoiceApi({
                invoice_id: invoiceId,
                action: newStatus,
                rejection_reason: rejectionReason,
            });

            if (response.message?.status === 200) {
                toast({
                    title: "Success",
                    description: `Invoice ${newStatus.toLowerCase()} successfully.`,
                    variant: "success",
                });
                if (onActionSuccess) {
                    onActionSuccess();
                }
            } else {
                throw new Error(response.message?.message || `Failed to ${newStatus.toLowerCase()} invoice.`);
            }
        } catch (error) {
            console.error(`Error updating invoice ${invoiceId} to ${newStatus}:`, error);
            toast({
                title: "Error",
                description: error instanceof Error ? error.message : "An unexpected error occurred.",
                variant: "destructive",
            });
        } finally {
            setLoadingInvoiceId(null);
            setConfirmationState(initialConfirmationState);
        }
    }, [approveInvoiceApi, toast, onActionSuccess]);

    const openConfirmationDialog = useCallback((invoice: VendorInvoice, action: "Approved" | "Rejected") => {
        setConfirmationState({
            isOpen: true,
            invoiceId: invoice.name,
            invoiceNo: invoice.invoice_no || invoice.document_name,
            action: action,
        });
    }, []);

    const closeConfirmationDialog = useCallback(() => {
        if (loadingInvoiceId) return;
        setConfirmationState(initialConfirmationState);
    }, [loadingInvoiceId]);

    const onConfirmAction = useCallback(async (rejectionReason?: string) => {
        if (confirmationState.invoiceId && confirmationState.action) {
            await handleUpdateInvoiceStatus(
                confirmationState.invoiceId,
                confirmationState.action,
                rejectionReason
            );
        }
    }, [confirmationState.invoiceId, confirmationState.action, handleUpdateInvoiceStatus]);

    const isProcessing = !!loadingInvoiceId || isApiLoading;

    return {
        openConfirmationDialog,
        closeConfirmationDialog,
        onConfirmAction,
        confirmationState,
        loadingInvoiceId,
        /** @deprecated Use loadingInvoiceId instead */
        loadingTaskId: loadingInvoiceId,
        isProcessing,
    };
};

/**
 * Alias with a more descriptive name.
 */
export const useInvoiceApprovalActions = useInvoiceTaskActions;
