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
    const { data, isLoading, error } = useFrappeGetDocList<VendorInvoice>(
        "Vendor Invoices",
        {
            // These extra fields feed the InvoiceDataDialog opened from the
            // "Invoice Total" cell (invoice list + attachment links).
            fields: ["name", "document_type", "document_name", "invoice_amount", "invoice_no", "invoice_date", "status", "invoice_attachment", "project"],
            filters: [["status", "in", ["Pending", "Approved"]]],
            limit: 100000,
        },
        "Recon-Total-Invoiced-By-Document"
    );

    const totalsMap = useMemo(() => data?.message ?? {}, [data]);

    // Per-parent list of the invoices composing the running total (for the hover).
    const invoicesMap = useMemo(() => {
        const map = new Map<string, VendorInvoice[]>();
        (data || []).forEach((row) => {
            const key = `${row.document_type}|${row.document_name}`;
            const list = map.get(key) || [];
            list.push(row);
            map.set(key, list);
        });
        return map;
    }, [data]);

    const getTotalInvoiced = useCallback(
        (docName: string, docType: string) =>
            totalsMap[`${docType}|${docName}`] || 0,
        [totalsMap]
    );

    const getInvoicesFor = useCallback(
        (docName: string, docType: string): VendorInvoice[] =>
            invoicesMap.get(`${docType}|${docName}`) || [],
        [invoicesMap]
    );

    return { getTotalInvoiced, getInvoicesFor, isLoading, error };
};
