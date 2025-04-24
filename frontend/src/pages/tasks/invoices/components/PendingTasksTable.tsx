// src/features/invoice-reconciliation/components/PendingTasksTable.tsx
import React from 'react';
import { useInvoiceTasks } from '../hooks/useInvoiceTasks';
import { useInvoiceTaskActions } from '../hooks/useInvoiceTaskActions';
import { getPendingTaskColumns } from './columns';
import { DataTable } from '@/components/data-table/data-table'; // Adjust path
import { TailSpin } from 'react-loader-spinner'; // Adjust path
import { useToast } from '@/components/ui/use-toast'; // Adjust path
import { ConfirmationDialog } from '@/pages/ProcurementRequests/ApproveVendorQuotes/components/ConfirmationDialog';

export const PendingTasksTable: React.FC = () => {
    const { toast } = useToast();
    const { tasks, isLoading, error, mutateTasks, attachmentsMap } = useInvoiceTasks('Pending');

    const {
        openConfirmationDialog,
        closeConfirmationDialog,
        onConfirmAction,
        confirmationState,
        loadingTaskId,
        isProcessing,
    } = useInvoiceTaskActions({
        onActionSuccess: mutateTasks, // Refresh data on success
    });

    const columns = React.useMemo(
        () => getPendingTaskColumns(openConfirmationDialog, loadingTaskId, isProcessing, attachmentsMap),
        [openConfirmationDialog, loadingTaskId, isProcessing, attachmentsMap] // Dependencies
    );

    if (error) {
        console.error("Error fetching pending tasks:", error);
        toast({ title: "Error", description: "Could not load pending invoice tasks.", variant: "destructive" });
        // Optionally return an error component
    }

    return (
        <div className="space-y-4">
            {isLoading ? (
                <div className="flex justify-center items-center p-8"><TailSpin color="red" width={50} height={50} /></div>
            ) : (
                <DataTable columns={columns} data={tasks || []} />
            )}

            <ConfirmationDialog
                isOpen={confirmationState.isOpen}
                onClose={closeConfirmationDialog}
                onConfirm={onConfirmAction}
                isLoading={loadingTaskId === confirmationState.taskId} // Show loader only for the specific task
                title={confirmationState.action === "Approved" ? "Confirm Approval" : "Confirm Rejection"}
                confirmText={confirmationState.action === "Approved" ? "Approve" : "Reject"}
                confirmVariant={confirmationState.action === "Approved" ? "default" : "destructive"}
            >
                <p className='text-sm text-muted-foreground text-center pt-2'>
                    Are you sure you want to{' '}
                    <strong className={confirmationState.action === "Rejected" ? "text-destructive" : "text-primary"}>
                        {confirmationState.action === "Approved" ? "Approve" : "Reject"}
                    </strong>
                    {' '}invoice{' '}
                    <strong>{confirmationState.taskInvoiceNo || `Task ID ${confirmationState.taskId}`}</strong>?
                </p>
            </ConfirmationDialog>
        </div>
    );
};

export default PendingTasksTable;