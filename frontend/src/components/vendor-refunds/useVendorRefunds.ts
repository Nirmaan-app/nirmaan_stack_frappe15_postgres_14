import { useFrappeGetCall } from "frappe-react-sdk";
import type { VendorRefundStatus } from "./RefundStatusBadge";

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
    status: VendorRefundStatus;
    /** Who recorded it as waiting from Adjust Payments (#1400); blank for one made from a bank line. */
    waiting_created_by?: string | null;
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

/** The SWR key of one PO's / WO's refund list, so a writer elsewhere can refresh it. */
export const vendorRefundsKey = (target: VendorRefundsTarget) =>
    `vendor-refunds-${target.documentType}-${target.documentName}`;

/**
 * The vendor refunds against one PO / WO, shown as rows of its Transaction Details. The read is
 * permission-aware: the doctype's read DocPerms mirror `Project Payments`, and project User Permissions
 * apply.
 */
export const useVendorRefunds = (target: VendorRefundsTarget) => {
    const ready = Boolean(target.documentName);
    const { data, error, isLoading, mutate } = useFrappeGetCall<{ message: VendorRefundRow[] }>(
        "nirmaan_stack.api.vendor_refunds.list_refunds.get_vendor_refunds",
        { document_type: target.documentType, document_name: target.documentName },
        ready ? vendorRefundsKey(target) : null
    );
    return { refunds: data?.message, error, isLoading, mutate };
};
