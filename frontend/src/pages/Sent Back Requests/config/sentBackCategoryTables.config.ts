import { SearchFieldOption } from '@/components/data-table/new-data-table';
import { SentBackCategory } from '@/types/NirmaanStack/SentBackCategory';

export const DEFAULT_SB_FIELDS_TO_FETCH: (keyof SentBackCategory | 'name')[] = [
    "name", "project", "owner", 'type', 'workflow_state', "order_list"
];

export const SB_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "name", label: "SB ID", placeholder: "Search by SB ID..." },
    { value: "project", label: "Project ID", placeholder: "Search by Project ID..." },
    // { value: "project_name", label: "Project Name", placeholder: "Search by Project Name..." },
    // { value: "workflow_state", label: "Status", placeholder: "Search by Status..." },
    {
        value: "order_list", // Field name for backend
        label: "Item in SB",
        placeholder: "Search by Item Name in SBs...",
        default: true,
        is_json: true, // Signal to backend for special JSON search logic
    },
];

// Date columns commonly used for filtering PO tables
export const SB_DATE_COLUMNS: string[] = ["creation", "modified"];

// Function to get static filters based on tab for Sent Back Category context
export const getSentBackStaticFilters = (tab: string): Array<[string, string, string | string[]]> => {
    const base: Array<[string, string, string | string[]]> = [
        ["workflow_state", "=", "Pending"]
    ];
    // const isEstimatesExec = role === "Nirmaan Estimates Executive Profile";
    // if (isEstimatesExec) {
    //     return [["status", "in", ["PO Approved", "Dispatched", "Partially Delivered", "Delivered"]]];
    // }

    if (tab === "All SBs") {
        return [];
    }
    if (tab) {
        return [...base, ["type", "=", tab]]
    }

    return base;
    // switch (tab) {
    //     case "Approved PO": return [...base, ["status", "=", "PO Approved"]];
    //     case "Dispatched PO": return [...base, ["status", "=", "Dispatched"]];
    //     case "Partially Delivered PO": return [...base, ["status", "=", "Partially Delivered"]];
    //     case "Delivered PO": return [...base, ["status", "=", "Delivered"]];
    //     default: return base; // Or specific default for this view
    // }
};