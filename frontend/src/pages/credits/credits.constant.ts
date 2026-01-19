
import { SearchFieldOption } from '@/components/data-table/new-data-table';

export const PO_PAYMENT_TERM_DOCTYPE = 'Procurement Orders';

// Define exactly what fields to pull. Use dot notation for parent fields.
export const TERM_LIST_FIELDS_TO_FETCH = [
    'name', "creation", "modified", "total_amount", "status as postatus", "project", "project_name", "vendor", "vendor_name", '`tabPO Payment Terms`.name as ptname', '`tabPO Payment Terms`.term_status', '`tabPO Payment Terms`.label', '`tabPO Payment Terms`.amount', '`tabPO Payment Terms`.percentage', '`tabPO Payment Terms`.due_date', '`tabPO Payment Terms`.modified as term_modified',]

// Define what the user can search for.
export const TERM_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "name", label: "PO Number", default: true },
    { value: "vendor_name", label: "Vendor" },
    { value: "project_name", label: "Project" },
];

// Define which columns should have a date range filter.
export const TERM_DATE_COLUMNS = ["due_date"];

// Define the options for the high-level status filter.
// "Due" now means: term_status = "Created" AND due_date <= today
// (calculated in useCredits.ts additionalFilters)
export const PAYMENT_TERM_STATUS_OPTIONS = [
    { label: "Due", value: "Due" },  // Semantic filter: Created + due_date <= today
    { label: "All Credits", value: "All" },
];

export type FacetOption = { label: string; value: string };
export type FacetConfig = { title: string; options: FacetOption[]; isLoading?: boolean };

// Status facet filter options
// "Due" = Created terms with due_date <= today (computed display_status)
// The backend translates "Due" filter to the correct SQL condition
export const CREDIT_FACET_FILTER_OPTIONS: Record<string, FacetConfig> = {
    'display_status': {
        title: "Status",
        options: [
            { label: "Due", value: "Due" },  // Created + past due_date
            { label: "Requested", value: "Requested" },
            { label: "Approved", value: "Approved" },
            { label: "Paid", value: "Paid" },
        ],
    },
    "project_name": {
        title: "Project",
        options: [], // We will populate this dynamically
    },
    "vendor_name": {
        title: "Vendor",
        options: [], // We will populate this dynamically
    },
};