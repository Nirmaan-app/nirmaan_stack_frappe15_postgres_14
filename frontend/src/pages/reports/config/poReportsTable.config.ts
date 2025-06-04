// frontend/src/pages/reports/config/poReportsTable.config.ts
import { SearchFieldOption } from '@/components/data-table/new-data-table';

export const PO_REPORTS_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "name", label: "PO ID", placeholder: "Search by PO ID...", default: true },
    { value: "projectName", label: "Project Name", placeholder: "Search by Project..." },
    { value: "vendorName", label: "Vendor Name", placeholder: "Search by Vendor..." },
    // Add originalDoc.status if you want to search by PO status string
];

export const PO_REPORTS_DATE_COLUMNS: string[] = ["creation", "dispatch_date"];