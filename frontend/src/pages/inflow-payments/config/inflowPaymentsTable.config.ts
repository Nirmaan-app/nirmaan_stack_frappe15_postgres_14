import { SearchFieldOption } from '@/components/data-table/new-data-table';
import { ProjectInflows } from '@/types/NirmaanStack/ProjectInflows';

// Fields to fetch for Inflow Payments tables
export const DEFAULT_INFLOW_FIELDS_TO_FETCH: (keyof ProjectInflows | 'name')[] = [
    "name", "creation", "modified", "owner", "project",
    "customer",
    "amount", "payment_date", "utr", "inflow_attachment"
];

// Searchable fields configuration for Inflow Payments tables
export const INFLOW_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "name", label: "Inflow ID", placeholder: "Search by Inflow ID..." },
    { value: "project", label: "Project ID", placeholder: "Search by Project ID..." },
    // { value: "project_name", label: "Project Name", placeholder: "Search by Project Name..." },
    { value: "customer", label: "Customer ID", placeholder: "Search by Customer ID..." },
    // { value: "customer_name", label: "Customer Name", placeholder: "Search by Customer Name..." },
    { value: "utr", label: "Payment (UTR)", placeholder: "Search by UTR...", default: true },
    { value: "amount", label: "Amount", placeholder: "Search by Amount..." },
];

// Date columns for Inflow Payments tables
export const INFLOW_DATE_COLUMNS: string[] = ["creation", "modified", "payment_date"];

// Function to get static filters based on props like customerId or projectId
export const getInflowStaticFilters = (
    customerId?: string,
    projectId?: string,
    // projectsForCustomer?: { name: string }[] // If filtering by projects of a customer
): Array<[string, string, any]> => {
    const filters: Array<[string, string, any]> = [];
    if (projectId) {
        filters.push(["project", "=", projectId]);
    }
    if (customerId) { // If customerId is primary, it implies filtering by that customer
        filters.push(["customer", "=", customerId]);
    }
    // If you need to filter by projects belonging to a customer, that logic would be:
    // if (customerId && projectsForCustomer && projectsForCustomer.length > 0) {
    //     filters.push(["project", "in", projectsForCustomer.map(p => p.name)]);
    // } else if (customerId && projectsForCustomer && projectsForCustomer.length === 0) {
    //     filters.push(["project", "in", ["__NON_EXISTENT_PROJECT__"]]); // No results
    // }
    return filters;
};