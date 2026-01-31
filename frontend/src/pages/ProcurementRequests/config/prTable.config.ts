import { SearchFieldOption } from '@/components/data-table/new-data-table';
import { ProcurementRequest } from '@/types/NirmaanStack/ProcurementRequests';

// Fields to fetch by default for most PR tables
export const DEFAULT_PR_FIELDS_TO_FETCH: (keyof ProcurementRequest | 'name')[] = [
    "name", "project", "owner", "workflow_state", "work_package", "order_list"
];

// Searchable fields Base configuration for PR tables
export const PR_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "name", label: "PR ID", placeholder: "Search by PR ID..." },
    { value: "project", label: "Project ID", placeholder: "Search by Project ID..." },
    // { value: "project_name", label: "Project Name", placeholder: "Search by Project Name..." },
    {
        value: "order_list",
        label: "Item in PR",
        placeholder: "Search by Item Name in PRs...",
        default: true,
        is_json: true, // Signal to backend for special JSON search logic

    },
];

// Date columns commonly used for filtering PR tables
export const PR_DATE_COLUMNS: string[] = ["creation", "modified"];

// Function to get static filters based on tab for Procurement Requests context
export const getPRStaticFilters = (tab: string): Array<[string, string, string | string[]]> => {
    const base: Array<[string, string, string | string[]]> = [];
    // const isEstimatesExec = role === "Nirmaan Estimates Executive Profile";
    // if (isEstimatesExec) {
    //     return [["status", "in", ["PO Approved", "Dispatched", "Partially Delivered", "Delivered"]]];
    // }
    switch (tab) {
        case "New PR Request": return [...base, ["workflow_state", "=", "Approved"]];
        case "In Progress": return [...base, ["workflow_state", "=", "In Progress"]];
        case "All PRs": return [];
        default: return base; // Or specific default for this view
    }
};