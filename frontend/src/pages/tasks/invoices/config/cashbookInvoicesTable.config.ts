import { SearchFieldOption } from '@/components/data-table/new-data-table';

/**
 * Pending Invoices Upload -> Cashbook table search (#1604).
 *
 * The table holds its rows in the browser (client mode), where the search box matches every column that allows
 * it -- Paid by, Remark, Project and Expense Type (`cashbookInvoiceColumns.tsx`) -- whatever field is picked. One
 * honest option says so, as on the Credit Card tab (`cardInvoicesTable.config.ts`).
 */
export const CASHBOOK_INVOICE_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    {
        value: "remark",
        label: "Remark",
        placeholder: "Search remark, paid by, project or expense type...",
        default: true,
    },
];

/** Columns with a date-range filter. */
export const CASHBOOK_INVOICE_DATE_COLUMNS: string[] = ["payment_date"];
