import { SearchFieldOption } from '@/components/data-table/new-data-table';
import { ServiceRequests } from '@/types/NirmaanStack/ServiceRequests';

// Fields to fetch by default for most SR tables
export const DEFAULT_SR_FIELDS_TO_FETCH: (keyof ServiceRequests | 'name')[] =  [
    "name", "project", "vendor", "status", "owner"
];

// Searchable fields configuration for SR tables
export const SR_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "name", label: "WO ID", placeholder: "Search by WO ID...", default: true },
    { value: "project", label: "Project ID", placeholder: "Search by Project ID..." },
    // { value: "project_name", label: "Project Name", placeholder: "Search by Project Name..." },
    { value: "vendor", label: "Vendor ID", placeholder: "Search by Vendor ID..." },
    // { value: "vendor_name", label: "Vendor Name", placeholder: "Search by Vendor Name..." },
    {
        value: "service_order_list", // Field name for backend
        label: "Service Description",
        placeholder: "Search by Service Desc in the list...",
        is_json: true, // Signal to backend for special JSON search logic
    },
];

// Date columns commonly used for filtering SR tables
export const SR_DATE_COLUMNS: string[] = ["creation", "modified"];