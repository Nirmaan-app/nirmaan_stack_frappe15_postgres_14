import { useFrappeGetCall } from "frappe-react-sdk";
import type { VendorRefundStatus } from "@/types/NirmaanStack/VendorRefunds";

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
    /** 1 while an Admin's "Received with no bank line" stands unmatched (#1403): the "No bank proof" badge. */
    no_bank_line?: number | null;
    /** Who marked it Received with no bank line, when and why; kept after a bank line is matched to it. */
    no_bank_line_by?: string | null;
    no_bank_line_at?: string | null;
    no_bank_line_reason?: string | null;
    utr?: string | null;
    payment_date?: string | null;
    description?: string | null;
    refund_attachment?: string | null;
    creation: string;
    /** A Bulk Import credit line is matched to it now: its UTR is that line's reference, fixed until Unreconcile. */
    bank_matched?: boolean;
}

/** The PO or WO whose refunds to list. */
export interface VendorRefundsTarget {
    documentType: "Procurement Orders" | "Service Requests";
    documentName: string;
}

/** One PO's refunds: the target every PO-page reader and writer names. */
export const poRefundsTarget = (poId: string): VendorRefundsTarget => ({
    documentType: "Procurement Orders",
    documentName: poId,
});

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
