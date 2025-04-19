import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFrappeDeleteDoc } from 'frappe-react-sdk';
import { useToast } from '@/components/ui/use-toast'; // Assuming toast is globally accessible

interface UseServiceRequestLogicProps {
    /** Callback function executed on successful deletion. Receives the name of the deleted SR. */
    onSuccess?: (deletedSrName: string) => void;
    /** Callback function executed on deletion error. Receives the error object and the name of the SR attempted. */
    onError?: (error: Error, srName: string) => void;
    /** Optional path to navigate to after successful deletion. */
    navigateOnSuccessPath?: string;
}

interface UseServiceRequestLogicReturn {
    /** Function to trigger the deletion of a specific Service Request by its name. */
    deleteServiceRequest: (srName: string) => Promise<void>;
    /** Boolean indicating if the deletion process is currently in progress. */
    isDeleting: boolean;
}

/**
 * Custom hook to handle the deletion of a "Service Requests" document.
 * Manages loading state, API call, success/error toasts, and optional navigation.
 */
export const useServiceRequestLogic = ({
    onSuccess,
    onError,
    navigateOnSuccessPath,
}: UseServiceRequestLogicProps = {}): UseServiceRequestLogicReturn => {

    const { deleteDoc, loading: isDeleting } = useFrappeDeleteDoc();
    const { toast } = useToast();
    const navigate = useNavigate();

    const deleteServiceRequest = useCallback(async (srName: string): Promise<void> => {
        if (!srName) {
            console.warn("deleteServiceRequest called without srName.");
            return;
        }

        try {
            // Perform the deletion using frappe-react-sdk hook
            await deleteDoc("Service Requests", srName);

            // Show success toast
            toast({
                title: "Success",
                description: `Service Request "${srName}" deleted successfully.`,
                variant: "success", // Optional: use a success variant if defined
            });

            // Call the onSuccess callback if provided
            if (onSuccess) {
                onSuccess(srName);
            }

            // Navigate if a path is provided
            if (navigateOnSuccessPath) {
                navigate(navigateOnSuccessPath, { replace: true }); // replace: true avoids the deleted page in history
            }

        } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err)); // Ensure we have an Error object
            console.error(`Failed to delete Service Request "${srName}":`, error);

            // Show error toast
            toast({
                title: "Error Deleting Item",
                description: error.message || "Could not delete the service request.",
                variant: "destructive",
            });

            // Call the onError callback if provided
            if (onError) {
                onError(error, srName);
            }
        }
        // No finally block needed as 'isDeleting' comes directly from useFrappeDeleteDoc
    }, [deleteDoc, toast, navigate, onSuccess, onError, navigateOnSuccessPath]);

    return {
        deleteServiceRequest,
        isDeleting, // Directly use the loading state from useFrappeDeleteDoc
    };
};