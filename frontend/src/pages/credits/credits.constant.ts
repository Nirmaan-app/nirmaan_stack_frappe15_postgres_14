
import { SearchFieldOption } from '@/components/data-table/new-data-table';

export const PO_PAYMENT_TERM_DOCTYPE = 'Procurement Orders';

// Define exactly what fields to pull. Use dot notation for parent fields.
export const TERM_LIST_FIELDS_TO_FETCH = [
    'name',"creation","modified", "total_amount","status as POstatus", "project", "project_name","vendor", "vendor_name",'`tabPO Payment Terms`.name as ptname', '`tabPO Payment Terms`.term_status', '`tabPO Payment Terms`.label', '`tabPO Payment Terms`.amount','`tabPO Payment Terms`.percentage', '`tabPO Payment Terms`.due_date','`tabPO Payment Terms`.modified as term_modified',]

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
    { label: "Due", value: "Scheduled" },
    { label: "All Credits", value: "All" },
    // { label:"Requested", value:"Requested"},

    // { label:"Approved", value:"Approved"},
    // { label:"Paid", value:"Paid"},
    // { label:"Return", value:"Return"},
    // { label:"Rejected", value:"Rejected"},

];

export const CREDIT_FACET_FILTER_OPTIONS = {
    'term_status': {
        title: "Status",
        options: [
            { label: "Due", value: "Scheduled" },
            { label: "Requested", value: "Requested" },
            { label: "Approved", value: "Approved" },
            { label: "Paid", value: "Paid" },
            { label: "Created", value: "Created" },
        ],
    },
    "project_name": {
        title: "Project",
        options: [], // We will populate this dynamically
    },
    // This key MUST match the field name on the PARENT table
    "vendor_name": {
        title: "Vendor",
        options: [], // We will populate this dynamically
    },
};