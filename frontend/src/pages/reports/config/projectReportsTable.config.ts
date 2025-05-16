import { SearchFieldOption } from '@/components/data-table/new-data-table';
import { ProcessedProject } from '../hooks/useProjectReportsData'; // Adjust path

// Define which fields from ProcessedProject are searchable by the client-side global filter
export const PROJECT_REPORTS_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "project_name", label: "Project Name", placeholder: "Search by Project Name...", default: true },
    { value: "name", label: "Project ID", placeholder: "Search by Project ID..." },
    // Add other fields from ProcessedProject if you want them to be searchable client-side
    // e.g., if customer name was added to ProcessedProject:
    // { value: "customer_name", label: "Customer", placeholder: "Search by Customer..." },
];

// Define which columns are date columns for the date filter component
export const PROJECT_REPORTS_DATE_COLUMNS: string[] = ["creation", "modified"]; // Assuming these are on ProcessedProject

// Define columns that can be used for faceted filtering (if any are suitable)
// For reports, facets might be less common unless on aggregated categories or statuses.
// For now, let's assume no specific faceted filters for this high-level report.
// Example if you had a 'project_status' field on ProcessedProject:
// export const PROJECT_REPORTS_FACET_OPTIONS_CONFIG = (statusOptions: {label: string; value: string}[]) => ({
//    project_status: { title: "Status", options: statusOptions },
// });