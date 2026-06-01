import { SearchFieldOption } from '@/components/data-table/new-data-table';
import { ServiceRequests } from '@/types/NirmaanStack/ServiceRequests';

// Fields to fetch by default for most SR tables
export const DEFAULT_SR_FIELDS_TO_FETCH: (keyof ServiceRequests | 'name')[] =  [
    "name", "project", "vendor", "status", "owner"
];

// Searchable fields configuration for SR tables
export const SR_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "name", label: "WO ID", placeholder: "Search by WO ID..." },
    { value: "project", label: "Project ID", placeholder: "Search by Project ID..." },
    // { value: "project_name", label: "Project Name", placeholder: "Search by Project Name..." },
    { value: "vendor", label: "Vendor ID", placeholder: "Search by Vendor ID..." },
    // { value: "vendor_name", label: "Vendor Name", placeholder: "Search by Vendor Name..." },
    {
        // Backend resolves this via CHILD_TABLE_ITEM_SEARCH_MAP["Service Requests"]
        // → searches `tabWork Order Items`.item_name ILIKE %query% joined on parent.
        // `is_json: true` is a misnomer kept for back-compat with useServerDataTable —
        // it signals the API to route via the item-search maps (JSON or child-table)
        // instead of treating `value` as a literal parent column. Same flag is set
        // on Procurement Requests' `order_list` (also a child table).
        value: "work_order_items",
        label: "Item in WO",
        placeholder: "Search by Service Desc in the list...",
        default: true,
        is_json: true,
    },
];

// Date columns commonly used for filtering SR tables
export const SR_DATE_COLUMNS: string[] = ["creation", "modified"];