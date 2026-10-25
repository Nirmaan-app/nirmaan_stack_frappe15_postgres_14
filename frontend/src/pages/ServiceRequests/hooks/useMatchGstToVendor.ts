import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";

/**
 * Match GST to vendor and the GST mismatch list (#1538, ADR-0028 Amendment A).
 *
 * GST follows the vendor: a Work Order's GST flag is on exactly when its vendor has a GST number. An
 * existing Work Order never changes by itself; Admin and Accountants bring one into line with
 * Match GST to vendor, after seeing its new total and Amount Due. The server owns every figure and
 * every check (`nirmaan_stack/api/service_requests/match_gst_to_vendor.py`).
 */
const API = "nirmaan_stack.api.service_requests.match_gst_to_vendor";

/** One Approved Work Order whose GST flag disagrees with its vendor. */
export interface GstMismatchRow {
    name: string;
    project: string;
    project_name?: string | null;
    vendor: string;
    vendor_name?: string | null;
    vendor_gst?: string | null;
    gst: string;
    target_gst: "true" | "false";
    is_finalized: 0 | 1;
    total_amount: number;
    amount_paid: number;
    amount_due: number;
    creation: string;
    /** GST payments on it: any one stops turning GST off. */
    gst_payments: number;
}

/** A Work Order now, and with its GST flag set from the vendor. */
export interface MatchGstFigures {
    work_order: string;
    status: string;
    is_finalized: 0 | 1;
    vendor: string;
    vendor_name?: string | null;
    vendor_gst: string;
    gst: "true" | "false";
    target_gst: "true" | "false";
    matches: boolean;
    total_before: number;
    total_after: number;
    amount_paid: number;
    amount_due_before: number;
    amount_due_after: number;
    /** GST payments that stop GST going off; empty when nothing blocks. */
    blocked_by: string[];
}

/** The GST mismatch list. Pass `enabled = false` to skip the fetch (a role that can't use it). */
export const useGstMismatchList = (enabled: boolean) => {
    const { data, isLoading, error, mutate } = useFrappeGetCall<{ message: GstMismatchRow[] }>(
        `${API}.get_gst_mismatch_work_orders`,
        undefined,
        enabled ? "gst_mismatch_work_orders" : null
    );
    return { rows: data?.message ?? [], isLoading, error, mutate };
};

/** The before / after preview for one Work Order. Pass `null` to skip the fetch (dialog closed). */
export const useMatchGstPreview = (workOrder: string | null) => {
    const { data, isLoading, error, mutate } = useFrappeGetCall<{ message: MatchGstFigures }>(
        `${API}.preview_match_gst_to_vendor`,
        { work_order: workOrder },
        workOrder ? `match_gst_preview_${workOrder}` : null
    );
    return { preview: data?.message, isLoading, error, mutate };
};

/** Apply Match GST to vendor. The reply carries the figures after the change. */
export const useMatchGstToVendor = () => {
    const { call, loading } = useFrappePostCall<{ message: MatchGstFigures }>(`${API}.match_gst_to_vendor`);
    const match = async (workOrder: string) => (await call({ work_order: workOrder })).message;
    return { match, loading };
};
