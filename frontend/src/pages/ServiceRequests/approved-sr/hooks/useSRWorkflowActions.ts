import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFrappeDeleteDoc, useFrappeUpdateDoc } from 'frappe-react-sdk';
import { toast } from '@/components/ui/use-toast';
import { ServiceRequests } from '@/types/NirmaanStack/ServiceRequests';
import { useCEOHoldGuard } from '@/hooks/useCEOHoldGuard';
import { invalidateSidebarCounts } from "@/hooks/useSidebarCounts";

interface UseSRWorkflowActionsProps {
    srId: string;
    srDoctype: "Service Requests"; // To make it explicit
    projectId?: string; // For CEO Hold guard
    onActionSuccess?: (action: 'delete' | 'amend_setup') => void; // For post-action tasks like mutate
    navigateOnDeletePath?: string;
}

export const useSRWorkflowActions = ({
    srId,
    srDoctype,
    projectId,
    onActionSuccess,
    navigateOnDeletePath = "/service-requests?tab=approved-sr", // Default
}: UseSRWorkflowActionsProps) => {
    const navigate = useNavigate();
    const { deleteDoc, loading: deleteLoading } = useFrappeDeleteDoc();
    const { updateDoc, loading: updateLoading } = useFrappeUpdateDoc(); // For amend status change
    const [isProcessing, setIsProcessing] = useState(false);

    // CEO Hold guard
    const { isCEOHold, showBlockedToast } = useCEOHoldGuard(projectId);

    const handleDeleteSR = useCallback(async () => {
        // CEO Hold guard
        if (isCEOHold) {
            showBlockedToast();
            return;
        }

        setIsProcessing(true);
        try {
            await deleteDoc(srDoctype, srId);
            toast({ title: "Success", description: `Service Request ${srId} deleted.` });
            invalidateSidebarCounts();
            onActionSuccess?.('delete');
            navigate(navigateOnDeletePath);
        } catch (error: any) {
            toast({ title: "Delete Failed", description: error.message || "Could not delete Service Request.", variant: "destructive" });
        } finally {
            setIsProcessing(false);
        }
    }, [srId, srDoctype, deleteDoc, navigate, navigateOnDeletePath, onActionSuccess, isCEOHold, showBlockedToast]);

    const setupSRAmendment = useCallback(async (originalSRData: ServiceRequests) => {
        // CEO Hold guard
        if (isCEOHold) {
            showBlockedToast();
            return;
        }

        // This usually involves creating a new SR in "Draft" or "Amendment" state,
        // linking it to the original, and possibly copying data.
        // For now, let's assume "Amend" just means changing status or opening an edit view.
        // If it's a more complex flow (like creating an amended copy):
        // const { createDoc } = useFrappeCreateDoc(); // would be needed
        setIsProcessing(true);
        try {
            // Example: Update status to indicate it's being amended, or navigate to an edit page.
            // For now, just a placeholder for a more complex amendment setup.
            // If "Amend" means going to an "edit" mode for the *current* SR, that's handled by page mode.
            // If "Amend" means creating a *new* SR based on this one:
            // 1. Read originalSRData
            // 2. Create new SR with status 'Draft' or 'Amendment', linked to original via 'amended_from'
            // 3. Navigate to the new SR's edit page.
            // This example just shows a toast and calls onSuccess.
            toast({ title: "Amendment Initiated", description: `Preparing amendment for ${srId}.` });
            onActionSuccess?.('amend_setup');
            // Example: navigate(`/service-requests/${srId}/amend`); // Or to a new SR if created
        } catch (error: any) {
            toast({ title: "Amendment Failed", description: error.message || "Could not start amendment.", variant: "destructive" });
        } finally {
            setIsProcessing(false);
        }
    }, [srId, onActionSuccess, navigate, isCEOHold, showBlockedToast]);


    return {
        deleteServiceRequest: handleDeleteSR,
        setupSRAmendment,
        isDeleting: deleteLoading || isProcessing, // Combine loading states
        isAmending: updateLoading || isProcessing, // For amend status change or setup
    };
};