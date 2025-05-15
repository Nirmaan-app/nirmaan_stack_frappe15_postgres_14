import React, { useCallback, useEffect, useMemo } from 'react';
import { getTaskHistoryColumns } from './columns';
// import { DataTable } from '@/components/data-table/data-table';
import { useToast } from '@/components/ui/use-toast';
import { useUsersList } from '@/pages/ProcurementRequests/ApproveNewPR/hooks/useUsersList';
import { DEFAULT_INVOICE_TASK_FIELDS_TO_FETCH, getInvoiceTaskStaticFilters, INVOICE_TASK_DATE_COLUMNS, INVOICE_TASK_SEARCHABLE_FIELDS } from '../config/InvoiceTaskTable.config';
import { useUserData } from '@/hooks/useUserData';
import { NirmaanAttachment } from '@/types/NirmaanStack/NirmaanAttachment';
import { useFrappeDocTypeEventListener, useFrappeGetDocList } from 'frappe-react-sdk';
import { InvoiceApprovalTask } from '@/types/NirmaanStack/Task';
import { useServerDataTable } from '@/hooks/useServerDataTable';
import { Terminal } from 'lucide-react';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { DataTable } from '@/components/data-table/new-data-table';
import { TableSkeleton } from '@/components/ui/skeleton';

// --- Constants ---
const DOCTYPE = 'Task';
const URL_SYNC_KEY = 'inv_history_tasks'; // Unique key for this table

export const TaskHistoryTable: React.FC = () => {
    const { toast } = useToast();
    const { role, user_id } = useUserData();
    // Fetch tasks *not* in Pending status
    // const { tasks, isLoading, error, attachmentsMap } = useInvoiceTasks('!= Pending');

    const {data: usersList} = useUsersList()

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
    const columns = React.useMemo(() => getTaskHistoryColumns(getUserName, attachmentsMap), [usersList, attachmentsMap]);

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


    // --- Realtime Event Listener ---
    useFrappeDocTypeEventListener(DOCTYPE, (event) => {

        refetch();
        toast({ title: "Invoice tasks updated.", duration: 2000 });
        // if (event.doc && event.doc.task_type === INVOICE_TASK_TYPE) {
        //     console.log(`Realtime event for ${DOCTYPE} (PendingTasksTable):`, event);
        //     // Refetch if status becomes Pending or changes from Pending
        //     if (event.doc.status === "Pending" || tasks?.find(t => t.name === event.doc.name)) {
        //         refetch();
        //         toast({ title: "Pending invoice tasks updated.", duration: 2000 });
        //     }
        // }
    });
    
    // --- Combined Loading & Error State ---
    const isLoadingOverall =  attachmentsLoading; // Consider attachments loading
    const combinedError = listError || attachmentsError; // Primary error from task list fetch
    
    if (combinedError) {
        // Display prominent error from data fetching/processing
        return (
             <Alert variant="destructive" className="m-4">
                <Terminal className="h-4 w-4" />
                <AlertTitle>Error Loading Invoice Tasks</AlertTitle>
                <AlertDescription>
                    Failed to fetch or process invoice data: {combinedError.message}
                </AlertDescription>
            </Alert>
        );
    }

    return (
        <div className="space-y-4">
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