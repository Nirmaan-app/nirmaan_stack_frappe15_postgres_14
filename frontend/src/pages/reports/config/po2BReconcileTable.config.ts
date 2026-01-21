import { SearchFieldOption } from '@/components/data-table/new-data-table';

export const PO_2B_RECONCILE_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "invoiceNo", label: "Invoice No", placeholder: "Search by Invoice No...", default: true },
    { value: "poId", label: "PO ID", placeholder: "Search by PO ID..." },
    { value: "projectName", label: "Project Name", placeholder: "Search by Project..." },
    { value: "vendorName", label: "Vendor Name", placeholder: "Search by Vendor..." },
];

export const PO_2B_RECONCILE_DATE_COLUMNS: string[] = ["invoiceDate", "reconciledDate"];

export const PO_2B_STATUS_OPTIONS = [
    { label: "Full", value: "Full" },
    { label: "Partial", value: "Partial" },
    { label: "None", value: "None" },
    { label: "N/A", value: "N/A" },
];
