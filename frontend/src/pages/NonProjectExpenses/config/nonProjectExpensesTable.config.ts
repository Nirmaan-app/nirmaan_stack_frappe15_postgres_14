// src/pages/non-project-expenses/config/nonProjectExpensesTable.config.ts

import { SearchFieldOption } from '@/components/data-table/new-data-table';
import { NonProjectExpenses } from '@/types/NirmaanStack/NonProjectExpenses';

export const DEFAULT_NPE_FIELDS_TO_FETCH: (keyof NonProjectExpenses | 'name' | 'owner' | `type.${string}`)[] = [
    "name",
    "creation",
    "modified",
    "owner",
    "type",
    "description",
    "comment",
    "amount",
    "payment_date",
    "payment_ref",
    "payment_attachment",
    "invoice_date",
    "invoice_ref",
    "invoice_attachment",
];

export const NPE_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "description", label: "Description", placeholder: "Search by Description...", default: true },
    { value: "comment", label: "Comment", placeholder: "Search by comment..." },
    { value: "payment_ref", label: "Payment Ref", placeholder: "Search by Payment Ref..." },
    { value: "invoice_ref", label: "Invoice Ref", placeholder: "Search by Invoice Ref..." },
    { value: "amount", label: "Amount", placeholder: "Search by Amount..." },
    { value: "type", label: "Expense Type", placeholder: "Search by Expense Type..." }, // Frappe typically searches linked field's display value too
];

export const NPE_DATE_COLUMNS: string[] = ["creation", "modified", "payment_date", "invoice_date"];

export const getNonProjectExpenseStaticFilters = (): Array<[string, string, any]> => {
    const filters: Array<[string, string, any]> = [];
    return filters;
};