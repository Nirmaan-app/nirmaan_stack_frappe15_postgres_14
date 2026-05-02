import { SearchFieldOption } from '@/components/data-table/new-data-table';

export const DCMIR_REPORTS_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "name", label: "Document ID", placeholder: "Search by ID..." },
    { value: "projectName", label: "Project", placeholder: "Search by Project..." },
    { value: "reference_number", label: "Reference No.", placeholder: "Search by Ref No...", default: true },
    { value: "procurement_order", label: "PO No.", placeholder: "Search by PO..." },
    { value: "itemsSummary", label: "Items", placeholder: "Search by Item..." },
];

// ITM-mode searchable fields — replaces PO No. with ITM No. and adds Source Project search.
export const DCMIR_REPORTS_ITM_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "name", label: "Document ID", placeholder: "Search by ID..." },
    { value: "projectName", label: "Target Project", placeholder: "Search by Target Project..." },
    { value: "reference_number", label: "Reference No.", placeholder: "Search by Ref No...", default: true },
    { value: "parent_docname", label: "ITM No.", placeholder: "Search by ITM..." },
    { value: "sourceProjectName", label: "Source Project", placeholder: "Search by Source Project..." },
    { value: "itemsSummary", label: "Items", placeholder: "Search by Item..." },
];

export const DCMIR_REPORTS_DATE_COLUMNS: string[] = ["dc_date"];
