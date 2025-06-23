import { SearchFieldOption } from '@/components/data-table/new-data-table';
import { ProcurementRequest } from '@/types/NirmaanStack/ProcurementRequests';


// --- Constants ---
export const DOCTYPE = 'Procurement Requests';
export const URL_SYNC_KEY_BASE = 'pr'; // Base key for URL params for this page


// Fields to fetch by default for most PR tables
export const DEFAULT_PR_FIELDS_TO_FETCH: (keyof ProcurementRequest | 'name')[] =  [
    "name", "project", "owner", "workflow_state", "work_package"
];
// Searchable fields Base configuration for PR tables

// Date columns commonly used for filtering PR tables
export const PR_DATE_COLUMNS: string[] = ["creation", "modified"];

export const PR_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "name", label: "PR ID", placeholder: "Search by PR ID...", default: true },
    { value: "project", label: "Project ID", placeholder: "Search by Project ID..." },
    // { value: "project_name", label: "Project Name", placeholder: "Search by Project Name..." },
    {
        value: "procurement_list",
        label: "Item in PR",
        placeholder: "Search by Item Name in procurement list...",
        is_json: true,
    },
];
