import { SearchFieldOption } from '@/components/data-table/new-data-table';

// Searchable fields configuration for PO Invoices table
export const PO_INVOICE_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "invoice_no", label: "Invoice No", placeholder: "Search by Invoice No...", default: true },
    { value: "procurement_order", label: "PO ID", placeholder: "Search by PO ID..." },
    { value: "vendor_name", label: "Vendor", placeholder: "Search by Vendor Name..." },
    { value: "project", label: "Project ID", placeholder: "Search by Project ID..." },
];

// Date columns for PO Invoices table (for date range filtering)
export const PO_INVOICE_DATE_COLUMNS: string[] = ["date", "reconciled_date"];

// 2B Activation status options
export const PO_INVOICE_2B_STATUS_OPTIONS = [
    { label: "Activated", value: "true" },
    { label: "Not Activated", value: "false" },
];
