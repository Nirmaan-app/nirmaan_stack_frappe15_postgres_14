import { SearchFieldOption } from '@/components/data-table/new-data-table';

// Searchable fields configuration for SR Invoices table
export const SR_INVOICE_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "invoice_no", label: "Invoice No", placeholder: "Search by Invoice No...", default: true },
    { value: "service_request", label: "SR ID", placeholder: "Search by SR ID..." },
    { value: "vendor_name", label: "Vendor", placeholder: "Search by Vendor Name..." },
    { value: "project", label: "Project ID", placeholder: "Search by Project ID..." },
];

// Date columns for SR Invoices table (for date range filtering)
export const SR_INVOICE_DATE_COLUMNS: string[] = ["date", "reconciled_date"];

// Reconciliation status options (replaces 2B Activation)
export const SR_INVOICE_RECONCILIATION_STATUS_OPTIONS = [
    { label: "Not Reconciled", value: "" },
    { label: "Partially Reconciled", value: "partial" },
    { label: "Fully Reconciled", value: "full" },
];

// @deprecated - Use SR_INVOICE_RECONCILIATION_STATUS_OPTIONS instead
export const SR_INVOICE_2B_STATUS_OPTIONS = [
    { label: "Activated", value: "true" },
    { label: "Not Activated", value: "false" },
];
