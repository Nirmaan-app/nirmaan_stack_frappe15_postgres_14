/**
 * Hook to compute the running total invoiced amount per parent PO/SR.
 *
 * Sums `invoice_amount` across all Vendor Invoices with status in
 * ['Pending', 'Approved'] grouped by (document_type, document_name) — same
 * scope as the backend `_check_po_amount_overage` / `_existing_invoiced_sum`
 * used by autofill validation. Returns a getter the table columns can call
 * per row.
 *
 * The aggregation runs server-side now (`get_invoice_totals_by_document`, a GROUP BY)
 * and returns the `"<document_type>|<document_name>" -> total` map directly, instead of
 * fetching every Pending/Approved Vendor Invoice (limit:100000) and reducing in the
 * browser. Numbers are byte-identical (unrounded server SUM == the former parseNumber
 * accumulation).
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
