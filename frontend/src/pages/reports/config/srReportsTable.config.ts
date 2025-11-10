// frontend/src/pages/reports/config/srReportsTable.config.ts
import { SearchFieldOption } from '@/components/data-table/new-data-table';

export const SR_REPORTS_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "name", label: "WO ID", placeholder: "Search by WO ID...", default: true },
    { value: "projectName", label: "Project Name", placeholder: "Search by Project..." },
    { value: "vendorName", label: "Vendor Name", placeholder: "Search by Vendor..." },
];

export const SR_REPORTS_DATE_COLUMNS: string[] = ["creation"];