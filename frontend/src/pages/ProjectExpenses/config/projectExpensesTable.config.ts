// src/pages/ProjectExpenses/config/projectExpensesTable.config.ts
// Create this new folder and file.

import { SearchFieldOption } from '@/components/data-table/new-data-table';
import { ProjectExpenses } from '@/types/NirmaanStack/ProjectExpenses';

export const DOCTYPE = 'Project Expenses';

// Fields to fetch for the Project Expenses table
export const DEFAULT_PE_FIELDS_TO_FETCH: (keyof ProjectExpenses | 'name' | 'owner')[] = [
    "name",
    "creation",
    "owner",
    "projects",
    "type",
    "vendor",
    "description",
    "comment",
    "amount",
    "payment_date",
    "payment_by",
];

// Searchable fields for the Project Expenses table
export const PE_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "description", label: "Description", placeholder: "Search by Description...", default: true },
    { value: "comment", label: "Comment", placeholder: "Search by Comment..." },
    { value: "type", label: "Expense Type", placeholder: "Search by Type..." }, // <-- Added
    { value: "vendor", label: "Vendor", placeholder: "Search by Vendor..." },
    { value: "payment_by", label: "Paid By", placeholder: "Search by User..." },
    { value: "amount", label: "Amount", placeholder: "Search by Amount..." },
];

// Date columns for the Project Expenses table
export const PE_DATE_COLUMNS: string[] = ["creation", "payment_date"];