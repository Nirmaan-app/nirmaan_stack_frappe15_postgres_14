/**
 * Hook to compute the running total invoiced amount per parent PO/SR.
 *
 * Sums `invoice_amount` across all Vendor Invoices with status in
 * ['Pending', 'Approved'] grouped by (document_type, document_name) — same
 * scope as the backend `_check_po_amount_overage` / `_existing_invoiced_sum`
 * used by autofill validation. Returns a getter the table columns can call
 * per row.
 *
 * Note: needs a separate fetch from the table's paginated query because the
 * Pending tab only fetches Pending rows, so Approved invoices for the same
 * parent wouldn't otherwise be visible to client-side aggregation.
 */
import { useCallback, useMemo } from "react";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { VendorInvoice } from "@/types/NirmaanStack/VendorInvoice";
import { parseNumber } from "@/utils/parseNumber";

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

    const totalsMap = useMemo(() => {
        const map = new Map<string, number>();
        (data || []).forEach((row) => {
            const key = `${row.document_type}|${row.document_name}`;
            const prev = map.get(key) || 0;
            map.set(key, prev + parseNumber(row.invoice_amount));
        });
        return map;
    }, [data]);

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
            totalsMap.get(`${docType}|${docName}`) || 0,
        [totalsMap]
    );

    const getInvoicesFor = useCallback(
        (docName: string, docType: string): VendorInvoice[] =>
            invoicesMap.get(`${docType}|${docName}`) || [],
        [invoicesMap]
    );

    return { getTotalInvoiced, getInvoicesFor, isLoading, error };
};
