import { SearchFieldOption } from '@/components/data-table/new-data-table';
import { Projects as ProjectsType } from '@/types/NirmaanStack/Projects'; // Adjust path

// Fields to fetch for the main Projects table
export const DEFAULT_PROJECT_FIELDS_TO_FETCH: (keyof ProjectsType | 'name')[] = [
    "name", "customer", "project_name", "project_type",
    "project_city", "project_state", "creation", "status", "owner", "project_value", "project_value_gst",
    "tendering_status",
];

// Searchable fields for the Projects table
export const PROJECT_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "name", label: "Project ID", placeholder: "Search by Project ID..." },
    { value: "project_name", label: "Project Name", placeholder: "Search by Project Name...", default: true },
    // { value: "customer", label: "Customer ID", placeholder: "Search by Customer ID..." },
    // Add customer_name if you fetch it and want to search by it directly
    { value: "project_type", label: "Project Type", placeholder: "Search by Type..." },
    { value: "project_city", label: "City", placeholder: "Search by City..." },
    { value: "project_state", label: "State", placeholder: "Search by State..." },
    { value: "status", label: "Status", placeholder: "Search by Status..." },
];

// Date columns for Projects table
export const PROJECT_DATE_COLUMNS: string[] = ["creation", "modified"];

// v3 dual-field model: the main project list shows ONLY awarded projects
// (`tendering_status = "Won"`); Tendering / Lost stubs live on the dedicated
// Tendering tab.
export const getProjectStaticFilters = (
    customerId?: string,
    includeTendering = false
): Array<[string, string, any]> => {
    const filters: Array<[string, string, any]> = [];
    if (customerId) {
        filters.push(["customer", "=", customerId]);
    }
    if (!includeTendering) {
        filters.push(["tendering_status", "=", "Won"]);
    }
    return filters;
};

// Tendering tab — shows BOTH Tendering and Lost stubs. The table component
// narrows further via a Tendering/Lost sub-toggle on top of these filters.
export const getTenderingStaticFilters = (
    customerId?: string,
    tenderingStatus: "Tendering" | "Lost" = "Tendering"
): Array<[string, string, any]> => {
    const filters: Array<[string, string, any]> = [
        ["tendering_status", "=", tenderingStatus],
    ];
    if (customerId) {
        filters.push(["customer", "=", customerId]);
    }
    return filters;
};
