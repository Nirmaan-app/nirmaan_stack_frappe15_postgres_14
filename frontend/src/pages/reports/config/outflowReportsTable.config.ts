// /workspace/development/frappe-bench/apps/nirmaan_stack/frontend/src/pages/reports/config/outflowReportsTable.config.ts

import { SearchFieldOption } from '@/components/data-table/new-data-table';

// Searchable fields for the Outflow Report table
// These keys must match the keys in our standardized `OutflowRowData` interface
export const OUTFLOW_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "details", label: "Details/Doc#", placeholder: "Search by details...", default: true },
    { value: "expense_type", label: "Expense Type", placeholder: "Search by type..." },
    { value: "project", label: "Project ID", placeholder: "Search by Project Name..." },
    { value: "vendor", label: "Vendor ID", placeholder: "Search by Vendor Name..." },
];

// Date columns for the Outflow Report table
export const OUTFLOW_DATE_COLUMNS: string[] = ["payment_date"];