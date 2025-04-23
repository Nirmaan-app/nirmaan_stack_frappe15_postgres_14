// src/features/invoice-reconciliation/hooks/useInvoiceTasks.ts
import { useFrappeGetDocList } from 'frappe-react-sdk';
import { InvoiceApprovalTask } from '@/types/NirmaanStack/Task'; // Adjust path
import { INVOICE_TASK_TYPE } from '../constants';

type StatusFilter = 'Pending' | '!= Pending'; // Define possible status filters

interface UseInvoiceTasksResult {
    tasks: InvoiceApprovalTask[] | null;
    isLoading: boolean;
    error: Error | null;
    mutateTasks: () => Promise<any>; // Or more specific type from useFrappeGetDocList
}

export const useInvoiceTasks = (statusFilter: StatusFilter): UseInvoiceTasksResult => {
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
            "reference_value_1", "reference_value_2", "reference_value_3",
            "task_type", "assignee",
        ],
        filters: [
            ["task_type", "=", INVOICE_TASK_TYPE],
            // Apply status filter dynamically
            statusFilter === 'Pending'
                ? ["status", "=", "Pending"]
                : ["status", "in", ["Pending", "Approved", "Rejected"]], // Fetch non-pending for history
        ],
        limit: 1000, // Consider pagination for production
        orderBy: { field: "modified", order: "desc" } // Sort by modified for recency
    });

    // Ensure error is always an Error object
    const typedError = error instanceof Error ? error : null;

    return {
        tasks: data || null,
        isLoading,
        error: typedError,
        mutateTasks: mutate,
    };
};