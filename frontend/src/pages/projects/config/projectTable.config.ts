import { SearchFieldOption } from '@/components/data-table/new-data-table';
import { Projects as ProjectsType } from '@/types/NirmaanStack/Projects'; // Adjust path

// Fields to fetch for the main Projects table
export const DEFAULT_PROJECT_FIELDS_TO_FETCH: (keyof ProjectsType | 'name')[] = [
    "name", "customer", "project_name", "project_type",
    "project_city", "project_state", "creation", "status", "owner", "project_value","project_value_gst" // Added owner, modified
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

// Function to get static filters based on props like customerId
export const getProjectStaticFilters = (customerId?: string): Array<[string, string, any]> => {
    const filters: Array<[string, string, any]> = [];
    if (customerId) {
        filters.push(["customer", "=", customerId]);
    }
    return filters;
};