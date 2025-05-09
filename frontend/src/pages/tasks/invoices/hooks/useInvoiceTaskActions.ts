// src/features/invoice-reconciliation/hooks/useInvoiceTaskActions.ts
import { useState, useCallback } from 'react';
import { useFrappePostCall } from 'frappe-react-sdk';
import { useToast } from "@/components/ui/use-toast"; // Adjust path
import { API_UPDATE_INVOICE_TASK_STATUS } from '../constants';
import { InvoiceApprovalTask } from '@/types/NirmaanStack/Task'; // Adjust path

interface ConfirmationState {
    isOpen: boolean;
    taskId: string | null;
    taskInvoiceNo?: string | null;
    action: "Approved" | "Rejected" | null;
}

const initialConfirmationState: ConfirmationState = {
    isOpen: false, taskId: null, taskInvoiceNo: null, action: null,
};

interface UseInvoiceTaskActionsProps {
    onActionSuccess?: () => void; // Optional callback after successful action
}

export const useInvoiceTaskActions = ({ onActionSuccess }: UseInvoiceTaskActionsProps = {}) => {
    const { toast } = useToast();
    const [confirmationState, setConfirmationState] = useState<ConfirmationState>(initialConfirmationState);
    const [loadingTaskId, setLoadingTaskId] = useState<string | null>(null); // Track loading per task

    const { call: updateTaskStatusApi, loading: isApiLoading } = useFrappePostCall(API_UPDATE_INVOICE_TASK_STATUS);

    const handleUpdateTaskStatus = useCallback(async (taskId: string, newStatus: "Approved" | "Rejected") => {
        setLoadingTaskId(taskId);
        try {
            const response = await updateTaskStatusApi({
                task_id: taskId,
                new_task_status: newStatus,
            });

            if (response.message?.status === 200) {
                toast({
                    title: "Success",
                    description: `Task ${newStatus.toLowerCase()} successfully.`,
                    variant: "success",
                });
                if (onActionSuccess) {
                    onActionSuccess(); // Call callback (e.g., mutateTasks)
                }
            } else {
                throw new Error(response.message?.message || `Failed to ${newStatus.toLowerCase()} task.`);
            }
        } catch (error) {
            console.error(`Error updating task ${taskId} to ${newStatus}:`, error);
            toast({
                title: "Error",
                description: error instanceof Error ? error.message : "An unexpected error occurred.",
                variant: "destructive",
            });
        } finally {
            setLoadingTaskId(null);
            setConfirmationState(initialConfirmationState); // Close dialog
        }
    }, [updateTaskStatusApi, toast, onActionSuccess]);

    const openConfirmationDialog = useCallback((task: InvoiceApprovalTask, action: "Approved" | "Rejected") => {
        setConfirmationState({
            isOpen: true,
            taskId: task.name,
            taskInvoiceNo: task.reference_value_2,
            action: action,
        });
    }, []);

    const closeConfirmationDialog = useCallback(() => {
        if (loadingTaskId) return; // Prevent closing while loading
        setConfirmationState(initialConfirmationState);
    }, [loadingTaskId]);

    const onConfirmAction = useCallback(async () => {
        if (confirmationState.taskId && confirmationState.action) {
            await handleUpdateTaskStatus(confirmationState.taskId, confirmationState.action);
        }
    }, [confirmationState.taskId, confirmationState.action, handleUpdateTaskStatus]);

    // Determine overall loading state for disabling buttons etc.
    const isProcessing = !!loadingTaskId || isApiLoading;

    return {
        openConfirmationDialog,
        closeConfirmationDialog,
        onConfirmAction,
        confirmationState,
        loadingTaskId, // Specific task ID being processed
        isProcessing, // General flag if *any* action is processing
    };
};