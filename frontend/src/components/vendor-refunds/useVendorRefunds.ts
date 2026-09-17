import { useFrappeGetCall } from "frappe-react-sdk";

/** One `Vendor Refunds` record, as `api/vendor_refunds/list_refunds.get_vendor_refunds` sends it. */
export interface VendorRefundRow {
    name: string;
    vendor: string;
    project?: string | null;
    /** "Procurement Orders" | "Service Requests" | "Misc. Expense". */
    document_type: string;
    /** Blank on a Misc. Expense refund. */
    document_name?: string | null;
    amount: number;
    utr?: string | null;
    payment_date?: string | null;
    description?: string | null;
    refund_attachment?: string | null;
    creation: string;
}

/** The PO or WO whose refunds to list. */
export interface VendorRefundsTarget {
    documentType: "Procurement Orders" | "Service Requests";
    documentName: string;
}

/**
 * The vendor refunds against one PO / WO. `enabled = false` skips the fetch (a closed dialog). The read
 * is permission-aware: the doctype's read DocPerms mirror `Project Payments`, and project User
 * Permissions apply.
 */
export const useVendorRefunds = (target: VendorRefundsTarget, enabled = true) => {
    const ready = enabled && Boolean(target.documentName);
    const { data, error, isLoading, mutate } = useFrappeGetCall<{ message: VendorRefundRow[] }>(
        "nirmaan_stack.api.vendor_refunds.list_refunds.get_vendor_refunds",
        { document_type: target.documentType, document_name: target.documentName },
        ready ? `vendor-refunds-${target.documentType}-${target.documentName}` : null
    );
    return { refunds: data?.message, error, isLoading, mutate };
};
