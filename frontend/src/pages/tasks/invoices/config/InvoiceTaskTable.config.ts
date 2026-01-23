/**
 * Table configuration for Vendor Invoices.
 *
 * Updated to use Vendor Invoices doctype fields instead of Task.
 */
import { SearchFieldOption } from '@/components/data-table/new-data-table';
import { VendorInvoice } from '@/types/NirmaanStack/VendorInvoice';

/**
 * Fields to fetch for Vendor Invoice tables
 */
export const DEFAULT_VENDOR_INVOICE_FIELDS_TO_FETCH: (keyof VendorInvoice | 'name')[] = [
    "name",
    "owner",
    "creation",
    "modified",
    "document_type",
    "document_name",
    "project",
    "vendor",
    "invoice_no",
    "invoice_date",
    "invoice_amount",
    "invoice_attachment",
    "status",
    "uploaded_by",
    "approved_by",
    "approved_on",
    "rejection_reason",
];

/**
 * @deprecated Use DEFAULT_VENDOR_INVOICE_FIELDS_TO_FETCH instead
 */
export const DEFAULT_INVOICE_TASK_FIELDS_TO_FETCH = DEFAULT_VENDOR_INVOICE_FIELDS_TO_FETCH;

/**
 * Searchable fields configuration for Vendor Invoice tables
 */
export const VENDOR_INVOICE_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "document_name", label: "Document", placeholder: "Search by PO/SR Number...", default: true },
    { value: "invoice_no", label: "Invoice No", placeholder: "Search by Invoice No...", default: true },
    { value: "document_type", label: "Document Type", placeholder: "Search by PO/SR Type..." },
    { value: "owner", label: "Created By", placeholder: "Search by Creator..." },
    { value: "invoice_amount", label: "Invoice Amt", placeholder: "Search by Invoice Amt..." },
];

/**
 * @deprecated Use VENDOR_INVOICE_SEARCHABLE_FIELDS instead
 */
export const INVOICE_TASK_SEARCHABLE_FIELDS = VENDOR_INVOICE_SEARCHABLE_FIELDS;

/**
 * Date columns for Vendor Invoice tables
 */
export const VENDOR_INVOICE_DATE_COLUMNS: string[] = ["creation", "modified", "invoice_date", "approved_on"];

/**
 * @deprecated Use VENDOR_INVOICE_DATE_COLUMNS instead
 */
export const INVOICE_TASK_DATE_COLUMNS = VENDOR_INVOICE_DATE_COLUMNS;

/**
 * Static filters for pending invoices
 */
export const PENDING_VENDOR_INVOICE_STATIC_FILTERS: Array<[string, string, any]> = [
    ["status", "=", "Pending"],
];

/**
 * @deprecated Use PENDING_VENDOR_INVOICE_STATIC_FILTERS instead
 */
export const PENDING_INVOICE_TASK_STATIC_FILTERS = PENDING_VENDOR_INVOICE_STATIC_FILTERS;

/**
 * Static filters for invoice history
 */
export const HISTORY_VENDOR_INVOICE_STATIC_FILTERS: Array<[string, string, any]> = [
    ["status", "in", ["Pending", "Approved", "Rejected"]],
];

/**
 * @deprecated Use HISTORY_VENDOR_INVOICE_STATIC_FILTERS instead
 */
export const HISTORY_INVOICE_TASK_STATIC_FILTERS = HISTORY_VENDOR_INVOICE_STATIC_FILTERS;

/**
 * Get static filters based on status and user role.
 */
export const getVendorInvoiceStaticFilters = (statusFilter: string, role: string, user_id: string) => {
    const base = statusFilter !== "Pending"
        ? HISTORY_VENDOR_INVOICE_STATIC_FILTERS
        : PENDING_VENDOR_INVOICE_STATIC_FILTERS;

    if (role === "Nirmaan Procurement Executive Profile") {
        return base.concat([['owner', '=', user_id]]);
    }
    return base;
};

/**
 * @deprecated Use getVendorInvoiceStaticFilters instead
 */
export const getInvoiceTaskStaticFilters = getVendorInvoiceStaticFilters;
