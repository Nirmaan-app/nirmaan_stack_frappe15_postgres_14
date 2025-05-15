import { SearchFieldOption } from '@/components/data-table/new-data-table';
import { InvoiceApprovalTask } from '@/types/NirmaanStack/Task'; // Adjust path
import { INVOICE_TASK_TYPE } from '../constants';

// Fields to fetch for Invoice Approval Task tables
export const DEFAULT_INVOICE_TASK_FIELDS_TO_FETCH: (keyof InvoiceApprovalTask | 'name')[] = [
    "name", "owner",
    "creation",
    "modified",
    "task_doctype", "task_docname", "status",
    "reference_value_1", // Invoice Date Key
    "reference_value_2", // Invoice No
    "reference_value_3", // Invoice Amount
    "reference_value_4", // Attachment ID for Invoice
    // "task_type", 
    "assignee",
];

// Searchable fields configuration for Invoice Approval Task tables
export const INVOICE_TASK_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    // { value: "name", label: "Task ID", placeholder: "Search by Task ID...", default: true },
    { value: "task_docname", label: "Parent Doc", placeholder: "Search by PO/SR Number...", default: true },
    { value: "task_doctype", label: "Parent Doc Type", placeholder: "Search by PO/SR Type...", default: true },
    { value: "reference_value_2", label: "Invoice No", placeholder: "Search by Invoice No..." },
    { value: "owner", label: "Created By", placeholder: "Search by Creator..." },
    { value: "reference_value_3", label: "Invoice Amt", placeholder: "Search by Invoice Amt..." },
    // { value: "assignee", label: "Actioned By", placeholder: "Search by Assignee..." },
];

// Date columns for Invoice Approval Task tables
export const INVOICE_TASK_DATE_COLUMNS: string[] = ["creation", "modified", "reference_value_1"]; // reference_value_1 is Invoice Date

// Static Filters for Pending Invoice Tasks
export const PENDING_INVOICE_TASK_STATIC_FILTERS: Array<[string, string, any]> = [
    ["task_type", "=", INVOICE_TASK_TYPE],
    ["status", "=", "Pending"],
];

// Static Filters for Invoice Task History (example for later)
export const HISTORY_INVOICE_TASK_STATIC_FILTERS: Array<[string, string, any]> = [
  ["task_type", "=", INVOICE_TASK_TYPE],
  ["status", "in", ["Pending", "Approved", "Rejected"]], // Example statuses for history
];


export const getInvoiceTaskStaticFilters = (statusFilter: string, role: string, user_id: string) => {
  const base = statusFilter !== "Pending" ? HISTORY_INVOICE_TASK_STATIC_FILTERS : PENDING_INVOICE_TASK_STATIC_FILTERS;
    if (role === "Nirmaan Procurement Executive Profile") {
        return base.concat(['owner', '=', user_id]);
    }
    return base;
}