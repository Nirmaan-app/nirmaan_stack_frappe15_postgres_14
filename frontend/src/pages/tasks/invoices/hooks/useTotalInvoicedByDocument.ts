/**
 * Hook to compute the running total invoiced amount per parent PO/SR.
 *
 * Sums `invoice_amount` across all Vendor Invoices with status in
 * ['Pending', 'Approved'] grouped by (document_type, document_name) — same
 * scope as the backend `_check_po_amount_overage` / `_existing_invoiced_sum`
 * used by autofill validation. Returns a getter the table columns can call
 * per row.
 *
 * The aggregation runs SERVER-SIDE (`get_invoice_totals_by_document`, a GROUP BY)
 * and returns the `"<document_type>|<document_name>" -> total` map directly. Numbers
 * are byte-identical to the former client-side reduce (an unrounded server SUM equals
 * the old parseNumber accumulation).
 *
 * ⚠️ DO NOT reintroduce a `useFrappeGetDocList` here to obtain the individual invoice
 * rows. That happened once: `getInvoicesFor` was added to feed the `vendorInvoices`
 * prop of `InvoiceDataDialog`, which brought back a `limit: 100000` whole-table fetch
 * on every visit to this screen. The prop had already been DELETED — the dialog
 * self-fetches its own rows scoped to one document (ADR-0010 #4 WS-B) — so the fetch
 * was feeding nothing. If a future consumer needs the rows, let it self-fetch for the
 * one document it cares about, exactly as the dialog does.
 */
import { useCallback, useMemo } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";

export const useTotalInvoicedByDocument = () => {
    const { data, isLoading, error } = useFrappeGetCall<{
        message: Record<string, number>;
    }>(
        "nirmaan_stack.api.invoices.get_vendor_invoice_totals.get_invoice_totals_by_document",
        undefined,
        "Recon-Total-Invoiced-By-Document"
    );

    const totalsMap = useMemo(() => data?.message ?? {}, [data]);

    const getTotalInvoiced = useCallback(
        (docName: string, docType: string) =>
            totalsMap[`${docType}|${docName}`] || 0,
        [totalsMap]
    );

    return { getTotalInvoiced, isLoading, error };
};
