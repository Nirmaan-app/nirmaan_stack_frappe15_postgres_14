
import { SearchFieldOption } from '@/components/data-table/new-data-table';

export const PO_PAYMENT_TERM_DOCTYPE = 'Procurement Orders';

// Define exactly what fields to pull. Use dot notation for parent fields.
export const TERM_LIST_FIELDS_TO_FETCH = [
    'name',"total_amount","project","project_name", "vendor_name", '`tabPO Payment Terms`.status', '`tabPO Payment Terms`.label', '`tabPO Payment Terms`.amount', '`tabPO Payment Terms`.due_date', '`tabPO Payment Terms`.payment_type'
];

// Define what the user can search for.
export const TERM_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "name", label: "PO Number", default: true },
    { value: "vendor_name", label: "Vendor" },
    { value: "project_name", label: "Project" },
];

// Define which columns should have a date range filter.
export const TERM_DATE_COLUMNS = ["due_date"];

// Define the options for the high-level status filter.
export const PAYMENT_TERM_STATUS_OPTIONS = [
    { label:"Due", value:"Scheduled"},
    { label: "All Credits", value: "All" },
    // { label:"Requested", value:"Requested"},
  
    // { label:"Approved", value:"Approved"},
    // { label:"Paid", value:"Paid"},
    // { label:"Return", value:"Return"},
    // { label:"Rejected", value:"Rejected"},
   
];

export const CREDIT_FACET_FILTER_OPTIONS = {
    "status": {
        title: "Status",
        options: [
            { label: "Due", value: "Scheduled" },
            { label: "Requested", value: "Requested" },
            { label: "Approved", value: "Approved" },
            { label: "Paid", value: "Paid" },
            { label: "Created", value: "Created" },
        ],
    },
};