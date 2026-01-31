import { SearchFieldOption } from '@/components/data-table/new-data-table';
import { ProjectInflows } from '@/types/NirmaanStack/ProjectInflows';

// Fields to fetch for the Inflow Report
export const DEFAULT_INFLOW_FIELDS_TO_FETCH: (keyof ProjectInflows | 'name')[] = [
    "name", "creation", "modified", "project",
    "customer", "amount", "payment_date", "utr", "inflow_attachment"
];

// Searchable fields for the Inflow Report
export const INFLOW_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "name", label: "Inflow ID", placeholder: "Search by Inflow ID..." },
    { value: "project", label: "Project ID", placeholder: "Search by Project ID..." },
    { value: "customer", label: "Customer ID", placeholder: "Search by Customer ID..." },
    { value: "utr", label: "Payment (UTR)", placeholder: "Search by UTR...", default: true },
];

// Date columns for the Inflow Report
export const INFLOW_DATE_COLUMNS: string[] = ["creation", "modified", "payment_date"];