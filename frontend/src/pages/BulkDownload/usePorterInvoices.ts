/**
 * Porter invoices for Report Bulk Download (owner, 2026-10-28): one row per Porter Invoice PDF (one PDF covers
 * many trips), Porter Invoice data only, every validation status that has a PDF. Read through the server's own
 * Admin / Accountant check (`api/pdf_helper/porter_invoices.get_porter_invoices`).
 */
import { useMemo } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";

/** One Porter Invoice; its id is Porter's invoice number. */
export interface PorterInvoiceRow {
    name: string;
    import_batch?: string;
    validation_status?: string;
    city?: string;
    completed_orders?: number;
    read_invoice_date?: string | null;
    fare_total?: number;
    tax_total?: number;
    creation: string;
}

/** The list, fetched only while `enabled` (the all scope, with the Porter card open). */
export const usePorterInvoices = (enabled: boolean) => {
    const { data, isLoading } = useFrappeGetCall<{ message: PorterInvoiceRow[] }>(
        "nirmaan_stack.api.pdf_helper.porter_invoices.get_porter_invoices",
        {},
        enabled ? "bulk-porter-all" : null,
        { revalidateOnFocus: false }
    );
    const porterInvoices = useMemo(() => data?.message ?? [], [data]);
    return { porterInvoices, porterInvoicesLoading: isLoading };
};
