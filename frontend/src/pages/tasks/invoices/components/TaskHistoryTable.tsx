import React, { useCallback, useEffect, useMemo } from 'react';
import { getTaskHistoryColumns } from './columns';
// import { DataTable } from '@/components/data-table/data-table';
import { useUsersList } from '@/pages/ProcurementRequests/ApproveNewPR/hooks/useUsersList';
import { DEFAULT_INVOICE_TASK_FIELDS_TO_FETCH, getInvoiceTaskStaticFilters, INVOICE_TASK_DATE_COLUMNS, INVOICE_TASK_SEARCHABLE_FIELDS } from '../config/InvoiceTaskTable.config';
import { useUserData } from '@/hooks/useUserData';
import { NirmaanAttachment } from '@/types/NirmaanStack/NirmaanAttachment';
import { useFrappeGetDocList,useFrappePostCall } from 'frappe-react-sdk';
import { InvoiceApprovalTask } from '@/types/NirmaanStack/Task';
import { useServerDataTable } from '@/hooks/useServerDataTable';
import { DataTable } from '@/components/data-table/new-data-table';
import { TableSkeleton } from '@/components/ui/skeleton';
import { AlertDestructive } from '@/components/layout/alert-banner/error-alert';
import { useOrderTotals } from '@/hooks/useOrderTotals';
import { useOrderPayments } from '@/hooks/useOrderPayments';

// --- Constants ---
const DOCTYPE = 'Task';
const URL_SYNC_KEY = 'inv_history_tasks'; // Unique key for this table

export const TaskHistoryTable: React.FC = () => {
    const { role, user_id } = useUserData();
    // Fetch tasks *not* in Pending status
    // const { tasks, isLoading, error, attachmentsMap } = useInvoiceTasks('!= Pending');

    const {data: usersList} = useUsersList()

    const {getTotalAmount,getDeliveredAmount,getVendorName} = useOrderTotals()
    const {getAmount} = useOrderPayments()

    const [attachmentIds, setAttachmentIds] = React.useState<string[]>([]);
    const [attachmentsData, setAttachmentsData] = React.useState<NirmaanAttachment[] | string | undefined>(undefined);

    // const { data: attachmentsData, isLoading: attachmentsLoading, error: attachmentsError } = useFrappeGetDocList<NirmaanAttachment>(
    //         "Nirmaan Attachments", {
    //             fields: ["name", "attachment"], // Fetch only what's needed
    //             filters: attachmentIds.length > 0 ? [["name", "in", attachmentIds]] : [],
    //             limit:1, // Fetch all relevant, or 1 if none to avoid error
    //         }, 
    //         attachmentIds.length > 0 ? `attachments_for_invoice_tasks_${attachmentIds.join('_')}` : null
    
    //     );

 const {
        call: fetchAttachments, // We get a function to call manually
        // data: attachmentsData,
        loading: attachmentsLoading,
        error: attachmentsError
    } = useFrappePostCall<NirmaanAttachment[]>('nirmaan_stack.api.tasks.attachment_names.get_attachments_by_name');

    // console.log("attachmentsData",attachmentsData)
    // --- This effect now calls our POST endpoint ---
    // In your TaskHistoryTable.tsx component

// --- This effect now calls our POST endpoint ---
useEffect(() => {
    // Define an async function inside the effect
    const performFetch = async () => {
        // Only fetch if we have IDs to look for
        if (attachmentIds && attachmentIds.length > 0) {
            // It's good practice to wrap async calls in a try...catch block
            try {
                // Now you can safely use await
                const response =await fetchAttachments({
                    // The parameter name must match the Python function's argument
                    attachment_names: attachmentIds 
                });
                // console.log("response",response?.message)
                setAttachmentsData(response?.message);
            } catch (err) {
                // If fetchAttachments rejects, the error will be caught here.
                // The `useFrappePostCall` hook will also populate its `error` state.
                console.error("An error occurred while calling fetchAttachments:", err);
            }
        }
    };

    // Call the function to execute it
    performFetch();
    
}, [attachmentIds, fetchAttachments]); // Add fetchAttachments to dependencies
   

    
  const attachmentsMap = useMemo(() => {
    // console.log(typeof attachmentsData, attachmentsData)
        if (!attachmentsData && !attachmentsLoading) {   
            return []; // Handles initial undefined state
        }

        let parsedData = attachmentsData||[];
    
        if (!Array.isArray(parsedData)) return {}; // Ensure it's an array before reducing

        return parsedData.reduce((acc, item) => {
            if (item && item.name && item.attachment) {
                acc[item.name] = item.attachment;
            }
            return acc;
        }, {} as Record<string, string>);
    }, [attachmentsData,attachmentsLoading]);

    
    const getUserName = useCallback((id: string | undefined): string => {
        if (!id) return '';
        if(id === "Administrator") return "Administrator"
        return usersList?.find(user => user.name === id)?.full_name || id; // Fallback to id if not found
      }, [usersList])


    const staticFilters = useMemo(() => getInvoiceTaskStaticFilters("", role, user_id), [role, user_id])
      
    const fetchFields = useMemo(() => DEFAULT_INVOICE_TASK_FIELDS_TO_FETCH, [])

    const invoiceTaskSearchableFeilds = useMemo(() => INVOICE_TASK_SEARCHABLE_FIELDS.concat([
        {value: "assignee", label: "Actioned By", placeholder: "Search by Assignee..."},
        { value: "status", label: "Status", placeholder: "Search by Status..." },
    ]), [])

    // Columns don't depend on actions here, so Memo has no dynamic dependencies
    const columns = React.useMemo(() => getTaskHistoryColumns(getUserName, attachmentsMap, getTotalAmount, getAmount,getDeliveredAmount,getVendorName), [usersList, attachmentsMap, getTotalAmount, getAmount,getDeliveredAmount,getVendorName]);

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
        <div className={`flex flex-col gap-2 mt-6 ${totalCount > 0 ? 'max-h-[calc(100vh-150px)] overflow-hidden' : ''}`}>
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
                    exportFileName="Invoice_Tasks"
                />
            )}
        </div>
    );
};


export default TaskHistoryTable;