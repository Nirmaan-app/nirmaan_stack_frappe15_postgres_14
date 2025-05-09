// src/features/invoice-reconciliation/hooks/useInvoiceTasks.ts
import { Filter, FrappeDoc, useFrappeGetDocList } from 'frappe-react-sdk';
import { InvoiceApprovalTask } from '@/types/NirmaanStack/Task'; // Adjust path
import { INVOICE_TASK_TYPE } from '../constants';
import { NirmaanAttachment } from '@/types/NirmaanStack/NirmaanAttachment';
import { useMemo } from 'react';
import { useUserData } from '@/hooks/useUserData';

type StatusFilter = 'Pending' | '!= Pending'; // Define possible status filters

interface UseInvoiceTasksResult {
    tasks: InvoiceApprovalTask[] | null;
    isLoading: boolean;
    error: Error | null;
    attachmentsMap?: Record<string, string>;
    mutateTasks: () => Promise<any>; // Or more specific type from useFrappeGetDocList
}

export const useInvoiceTasks = (statusFilter: StatusFilter): UseInvoiceTasksResult => {

    const { role, user_id } = useUserData();
    const isProcurementUser = role === "Nirmaan Procurement Executive Profile";


    const taskFilters: Filter<FrappeDoc<InvoiceApprovalTask>>[] = [
        ["task_type", "=", INVOICE_TASK_TYPE],
        statusFilter === 'Pending'
            ? ["status", "=", "Pending"]
            : ["status", "in", ["Pending", "Approved", "Rejected"]],
    ];

    // Conditionally add the owner filter
    if (isProcurementUser && user_id) {
        taskFilters.push(["owner", "=", user_id]);
    }
    // --- End of filter building ---
    const {
        data,
        isLoading,
        error,
        mutate,
    } = useFrappeGetDocList<InvoiceApprovalTask>("Task", {
        fields: [
            // List all fields needed by *both* pending and history tables
            "name", "creation", "modified", "owner",
            "task_doctype", "task_docname", "status",
            "reference_value_1", "reference_value_2", "reference_value_3", "reference_value_4",
            "task_type", "assignee",
        ],
        filters: taskFilters,
        limit: 100000, // Consider pagination for production
        orderBy: { field: "modified", order: "desc" } // Sort by modified for recency
    });

    // --- Prepare Attachment Filters Safely ---
    const attachmentIds = useMemo<string[]>(() => {
        return (data
            ?.map(task => task?.reference_value_4)
            .filter((id): id is string => typeof id === 'string' && id.length > 0)
            ?? []) as string[];
    }, [data]);

    // Determine if the attachments query should run
    const shouldFetchAttachments = attachmentIds.length > 0;

    // Define the filter only when needed
    const attachmentFilters = shouldFetchAttachments
        ? [["name", "in", attachmentIds] as Filter<FrappeDoc<NirmaanAttachment>>] // Assert type here
        : []; // Provide an empty array if not fetching (or handle conditionally below)


    const {data: attachments, isLoading: attachmentsLoading} = useFrappeGetDocList<NirmaanAttachment>("Nirmaan Attachments", {
        fields: ["name", "attachment", "attachment_link_doctype", "attachment_link_docname"],
        filters: attachmentFilters,
        limit: 1000,
    }, `attachments_for_${statusFilter}_tasks`);

    const attachmentsMap = useMemo(() => {
        // Ensure attachments is not null/undefined before reducing
        if (!attachments) {
            return {}; // Return empty map if no attachments fetched/available
        }
        return attachments.reduce((acc, item) => {
            if (item?.name && item.attachment) { // Add checks for safety
                acc[item.name] = item.attachment;
            }
            return acc;
        }, {} as Record<string, string>);
    }, [attachments]);
    

    // Ensure error is always an Error object
    const typedError = error instanceof Error ? error : null;

    return {
        tasks: data || null,
        attachmentsMap,
        isLoading : isLoading || attachmentsLoading,
        error: typedError,
        mutateTasks: mutate,
    };
};