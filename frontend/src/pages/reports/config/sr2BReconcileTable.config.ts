import { SearchFieldOption } from '@/components/data-table/new-data-table';

export const SR_2B_RECONCILE_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "invoiceNo", label: "Invoice No", placeholder: "Search by Invoice No...", default: true },
    { value: "srId", label: "WO ID", placeholder: "Search by WO ID..." },
    { value: "projectName", label: "Project Name", placeholder: "Search by Project..." },
    { value: "vendorName", label: "Vendor Name", placeholder: "Search by Vendor..." },
];

export const SR_2B_RECONCILE_DATE_COLUMNS: string[] = ["invoiceDate", "reconciledDate"];

export const SR_2B_STATUS_OPTIONS = [
    { label: "Reconciled", value: "Reconciled" },
    { label: "Pending", value: "Pending" },
];
