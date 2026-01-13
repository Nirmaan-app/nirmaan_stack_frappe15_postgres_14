import { SearchFieldOption } from '@/components/data-table/new-data-table';

export const PO_ATTACHMENT_RECONCILE_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "name", label: "PO ID", placeholder: "Search by PO ID...", default: true },
    { value: "projectName", label: "Project", placeholder: "Search by Project..." },
    { value: "vendorName", label: "Vendor", placeholder: "Search by Vendor..." },
];

export const PO_ATTACHMENT_RECONCILE_DATE_COLUMNS: string[] = ["creation", "latestDeliveryDate"];

export const PO_ATTACHMENT_STATUS_OPTIONS = [
    { label: "Delivered", value: "Delivered" },
    { label: "Partially Delivered", value: "Partially Delivered" },
];
