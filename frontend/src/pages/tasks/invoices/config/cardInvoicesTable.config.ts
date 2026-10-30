import { SearchFieldOption } from '@/components/data-table/new-data-table';

/**
 * Pending Invoices Upload -> Credit Card table search.
 *
 * The table holds its rows in the browser (client mode), where the search box matches every column that
 * allows it -- Transaction details, Expense Type, Holder and Statement (`cardInvoiceColumns.tsx`) -- whatever field is
 * picked. One honest option says so, rather than a picker that would not narrow anything.
 */
export const CARD_INVOICE_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    {
        value: "transaction_details",
        // Short: the field picker is 150px wide and cut "Transaction details" off.
        label: "Transaction",
        placeholder: "Search merchant, holder, expense type or statement...",
        default: true,
    },
];

/** Columns with a date-range filter. */
export const CARD_INVOICE_DATE_COLUMNS: string[] = ["payment_date"];
