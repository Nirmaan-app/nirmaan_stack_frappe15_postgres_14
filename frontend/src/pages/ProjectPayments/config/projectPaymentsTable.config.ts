import { SearchFieldOption } from '@/components/data-table/new-data-table';
import { ProjectPayments } from '@/types/NirmaanStack/ProjectPayments';
import { PAYMENT_STATUS } from '../approve-payments/constants';

export const DEFAULT_PP_FIELDS_TO_FETCH: (keyof ProjectPayments | 'name')[] =  [
    "name", "project", "owner", "vendor", "document_name", "document_type",
    "status", "amount"
];

export const PP_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "name", label: "Payment ID", placeholder: "Search by Payment ID...", default: true },
    { value: "project", label: "Project ID", placeholder: "Search by Project ID..." },
    // { value: "project_name", label: "Project Name", placeholder: "Search by Project Name..." },
    { value: "vendor", label: "Vendor ID", placeholder: "Search by Vendor ID..." },
    {value: "document_name", label: "Document Name", placeholder: "Search by Document Name..."},
    {value: "document_type", label: "Document Type", placeholder: "Search by Document Type..."},
    {value: "amount", label: "Amount", placeholder: "Search by Amount..."},
];

// Date columns commonly used for filtering Payments tables
export const PP_DATE_COLUMNS: string[] = ["creation", "modified", "payment_date"];

// Function to get static filters based on tab for ProjectPayments context
export const getProjectPaymentsStaticFilters = (tab: string): Array<[string, string, string | string[]]> => {

    const base: Array<[string, string, string | string[]]> = [];

    // const isEstimatesExec = role === "Nirmaan Estimates Executive Profile";
    // if (isEstimatesExec) {
    //     return [["status", "in", ["PO Approved", "Dispatched", "Partially Delivered", "Delivered"]]];
    // }
    switch (tab) {
        case "New Payments": return [...base, ["status", "=", PAYMENT_STATUS.APPROVED]];
        case "Fulfilled Payments": return [...base, ["status", "=", PAYMENT_STATUS.PAID]];
        case "Payments Done": return [...base, ["status", "=", PAYMENT_STATUS.PAID]];
        case "Payments Pending": return [...base, ["status", "in", [PAYMENT_STATUS.REQUESTED, PAYMENT_STATUS.APPROVED]]];
        case "All Payments": return [];
        default: return base; // Or specific default for this view
    }
};