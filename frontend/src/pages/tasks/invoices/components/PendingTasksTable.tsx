import React, { useEffect, useMemo } from 'react';
import { useInvoiceTaskActions } from '../hooks/useInvoiceTaskActions';
import { getPendingTaskColumns } from './columns';
// import { DataTable } from '@/components/data-table/data-table'; // Adjust path
import { ConfirmationDialog } from '@/pages/ProcurementRequests/ApproveVendorQuotes/components/ConfirmationDialog';
import { useFrappeGetDocList } from 'frappe-react-sdk';
import { NirmaanAttachment } from '@/types/NirmaanStack/NirmaanAttachment';
import { useServerDataTable } from '@/hooks/useServerDataTable';
import { InvoiceApprovalTask } from '@/types/NirmaanStack/Task';
import { DEFAULT_INVOICE_TASK_FIELDS_TO_FETCH, getInvoiceTaskStaticFilters, INVOICE_TASK_DATE_COLUMNS, INVOICE_TASK_SEARCHABLE_FIELDS } from '../config/InvoiceTaskTable.config';
import { TableSkeleton } from '@/components/ui/skeleton';
import { DataTable } from '@/components/data-table/new-data-table';
import { useUserData } from '@/hooks/useUserData';
import { AlertDestructive } from '@/components/layout/alert-banner/error-alert';
import { useOrderTotals } from '@/hooks/useOrderTotals';
import { useOrderPayments } from '@/hooks/useOrderPayments';


// --- Constants ---
const DOCTYPE = 'Task';
const URL_SYNC_KEY = 'inv_pending_tasks'; // Unique key for this table

export const PendingTasksTable: React.FC = () => {
    const { role, user_id } = useUserData();
    // const { tasks, isLoading, error, mutateTasks, attachmentsMap } = useInvoiceTasks('Pending');

    // --- Fetch Attachments (Supporting Data) ---
    // This logic remains, but its data will be passed to columns.
    // We need the main task list first to know which attachment IDs to fetch.
    const [attachmentIds, setAttachmentIds] = React.useState<string[]>([]);
    const { data: attachmentsData, isLoading: attachmentsLoading, error: attachmentsError } = useFrappeGetDocList<NirmaanAttachment>(
        "Nirmaan Attachments", {
            fields: ["name", "attachment"], // Fetch only what's needed
            filters: attachmentIds.length > 0 ? [["name", "in", attachmentIds]] : [],
            limit: attachmentIds.length || 1, // Fetch all relevant, or 1 if none to avoid error
        }, 
        attachmentIds.length > 0 ? `attachments_for_invoice_tasks_${attachmentIds.join('_')}` : null
    );

    const attachmentsMap = useMemo(() => {
        if (!attachmentsData) return {};
        return attachmentsData.reduce((acc, item) => {
            if (item.name && item.attachment) acc[item.name] = item.attachment;
            return acc;
        }, {} as Record<string, string>);
    }, [attachmentsData]);

    // --- Action Handling ---
    const {
        openConfirmationDialog, closeConfirmationDialog, onConfirmAction,
        confirmationState, loadingTaskId, isProcessing,
    } = useInvoiceTaskActions({
        // onActionSuccess: refetch, // Pass the refetch function from useServerDataTable
    });

    const {getTotalAmount,getDeliveredAmount,getVendorName} = useOrderTotals()
    const {getAmount} = useOrderPayments()

    // --- Column Definitions (Memoized with dependencies) ---
    const columns = React.useMemo(
        () => getPendingTaskColumns(openConfirmationDialog, loadingTaskId, isProcessing, attachmentsMap, getTotalAmount ,getAmount,getDeliveredAmount,getVendorName),
        [openConfirmationDialog, loadingTaskId, isProcessing, attachmentsMap, getTotalAmount, getAmount,getDeliveredAmount,getVendorName]
    );

    const staticFilters = useMemo(() => getInvoiceTaskStaticFilters("Pending", role, user_id), [role, user_id])

    const fetchFields = useMemo(() => DEFAULT_INVOICE_TASK_FIELDS_TO_FETCH, [])

    const invoiceTaskSearchableFeilds = useMemo(() => INVOICE_TASK_SEARCHABLE_FIELDS, [])

    // --- Main Data Table Hook ---
    const {
        table, data: tasks, totalCount, isLoading: listIsLoading, error: listError,
        searchTerm, setSearchTerm, selectedSearchField, setSelectedSearchField,
        isRowSelectionActive, refetch,
    } = useServerDataTable<InvoiceApprovalTask>({
        doctype: DOCTYPE,
        columns: columns, // Columns passed dynamically later, including actions
        fetchFields: fetchFields,
        searchableFields: invoiceTaskSearchableFeilds,
        urlSyncKey: URL_SYNC_KEY,
        defaultSort: 'modified desc',
        additionalFilters: staticFilters,
        enableRowSelection: false, // No bulk actions defined for pending tasks yet
    });

    // Effect to extract attachment IDs from fetched tasks
    useEffect(() => {
        if (tasks && tasks.length > 0) {
            const ids = tasks
                .map(task => task?.reference_value_4) // reference_value_4 is attachment_id
                .filter((id): id is string => typeof id === 'string' && id.length > 0);
            if (ids.length > 0) {
                 // Avoid setting if identical to prevent re-renders
                setAttachmentIds(currentIds => {
                    const newIdsSet = new Set(ids);
                    const currentIdsSet = new Set(currentIds);
                    if (newIdsSet.size === currentIdsSet.size && [...newIdsSet].every(id => currentIdsSet.has(id))) {
                        return currentIds;
                    }
                    return ids;
                });
            } else {
                setAttachmentIds([]);
            }
        } else {
            setAttachmentIds([]);
        }
    }, [tasks]);


    // --- Combined Loading & Error State ---
    const isLoadingOverall =  attachmentsLoading; // Consider attachments loading
    const combinedError = listError || attachmentsError; // Primary error from task list fetch

    if (combinedError) {
        // Display prominent error from data fetching/processing
        return (
             <AlertDestructive error={combinedError} />
        );
    }

    return (
        <div className="flex-1 space-y-4">
            {isLoadingOverall && !tasks?.length ? ( // Show skeleton if main list is loading and no data yet
                <TableSkeleton />
            ) : (
                <DataTable<InvoiceApprovalTask>
                    table={table}
                    columns={columns} // Pass the memoized columns
                    isLoading={listIsLoading} // Loading state for the table data itself
                    error={listError}
                    totalCount={totalCount}
                    searchFieldOptions={invoiceTaskSearchableFeilds}
                    selectedSearchField={selectedSearchField}
                    onSelectedSearchFieldChange={setSelectedSearchField}
                    searchTerm={searchTerm}
                    onSearchTermChange={setSearchTerm}
                    // No facet filters defined for this view currently
                    dateFilterColumns={INVOICE_TASK_DATE_COLUMNS}
                    showExportButton={true}
                    onExport={'default'}
                    exportFileName="Pending_Invoice_Tasks"
                />
            )}

            <ConfirmationDialog
                isOpen={confirmationState.isOpen}
                onClose={closeConfirmationDialog}
                onConfirm={async () => {
                    await onConfirmAction();
                    refetch();
                }}
                isLoading={loadingTaskId === confirmationState.taskId}
                title={confirmationState.action === "Approved" ? "Confirm Approval" : "Confirm Rejection"}
                confirmText={confirmationState.action === "Approved" ? "Approve" : "Reject"}
                confirmVariant={confirmationState.action === "Approved" ? "default" : "destructive"}
            >
                <p className='text-sm text-muted-foreground text-center pt-2'>
                    Are you sure you want to{' '}
                    <strong className={confirmationState.action === "Rejected" ? "text-destructive" : "text-primary"}>
                        {confirmationState.action === "Approved" ? "Approve" : "Reject"}
                    </strong>
                    {' '}invoice for task referencing{' '}
                    <strong>{confirmationState.taskInvoiceNo || `Task ID ${confirmationState.taskId}`}</strong>?
                </p>
            </ConfirmationDialog>
        </div>
    );
};

export default PendingTasksTable;