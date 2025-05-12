import { SearchFieldOption } from '@/components/data-table/new-data-table'; // Adjust path if needed
import { ProcurementOrder } from '@/types/NirmaanStack/ProcurementOrders'; // Adjust path

// Fields to fetch by default for most PO tables
export const DEFAULT_PO_FIELDS_TO_FETCH: (keyof ProcurementOrder | 'name')[] =  [
    "name", "project", "vendor", "project_name",
    "vendor_name", "status", "owner", "custom",
];

// Searchable fields configuration for PO tables
export const PO_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "name", label: "PO ID", placeholder: "Search by PO ID...", default: true },
    { value: "project", label: "Project ID", placeholder: "Search by Project ID..." },
    { value: "project_name", label: "Project Name", placeholder: "Search by Project Name..." },
    { value: "vendor", label: "Vendor ID", placeholder: "Search by Vendor ID..." },
    { value: "vendor_name", label: "Vendor Name", placeholder: "Search by Vendor Name..." },
    {
        value: "order_list", // Field name for backend
        label: "Item in PO",
        placeholder: "Search by Item Name in order list...",
        is_json: true, // Signal to backend for special JSON search logic
    },
];

// Date columns commonly used for filtering PO tables
export const PO_DATE_COLUMNS: string[] = ["creation", "modified"];

// Function to get static filters based on tab and role for ReleasePOSelect context
export const getReleasePOSelectStaticFilters = (tab: string, role?: string): Array<[string, string, string | string[]]> => {
    const base: Array<[string, string, string | string[]]> = [
        ["status", "not in", ["Merged", "PO Amendment"]]
    ];
    const isEstimatesExec = role === "Nirmaan Estimates Executive Profile";
    if (isEstimatesExec) {
        return [["status", "in", ["PO Approved", "Dispatched", "Partially Delivered", "Delivered"]]];
    }
    switch (tab) {
        case "Approved PO": return [...base, ["status", "=", "PO Approved"]];
        case "Dispatched PO": return [...base, ["status", "=", "Dispatched"]];
        case "Partially Delivered PO": return [...base, ["status", "=", "Partially Delivered"]];
        case "Delivered PO": return [...base, ["status", "=", "Delivered"]];
        default: return base; // Or specific default for this view
    }
};