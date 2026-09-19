import { useMemo } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";
import formatToIndianRupee from "@/utils/FormatPrice";

/**
 * GST Hold (ADR-0028) — a vendor with no GST number whose GST-off Work Orders this financial year
 * total more than ₹15,00,000 is put on hold by a daily job, and cannot get a new Work Order until an
 * Admin removes it. The job never releases a vendor.
 *
 * NOT Vendor Hold (`vendor_status` On-Hold, the credit hold — `useVendorHoldGuard`).
 *
 * The rule is owned by the backend (`nirmaan_stack/services/wo_vendor_limit.py`); the server also
 * refuses a new WO for a vendor on hold, so this hook only mirrors the verdict early.
 */
export interface GstOffWorkOrder {
    name: string;
    project: string;
    project_name?: string;
    status: string;
    creation: string;
    total_amount: number; // pre-GST: on a GST-off WO this IS qty × rate
    amount_paid: number;
}

export interface VendorGstHoldSummary {
    vendor: string;
    gst_hold: 0 | 1;
    total: number; // sum of `work_orders[].total_amount`
    wo_count: number;
    fy_start: string; // YYYY-MM-DD
    fy_end: string; // YYYY-MM-DD (inclusive)
    limit: number;
    work_orders: GstOffWorkOrder[];
}

export interface VendorGstHoldState {
    summary: VendorGstHoldSummary | undefined;
    isChecking: boolean;
    isOnGstHold: boolean;
    mutate: () => void;
}

/** formatToIndianRupee renders 0 as "--"; a vendor with no WOs yet should read ₹0.00. */
export const rupees = (amount: number) => (amount ? formatToIndianRupee(amount) : "₹0.00");

/** "FY 26-27" from the endpoint's YYYY-MM-DD bounds. */
export const fyLabel = (summary: VendorGstHoldSummary) =>
    `FY ${summary.fy_start.slice(2, 4)}-${summary.fy_end.slice(2, 4)}`;

/** How far the FY total is above the limit; 0 when it is not above. */
export const amountOverLimit = (summary: VendorGstHoldSummary) => Math.max(summary.total - summary.limit, 0);

export const GST_HOLD_BLOCKED_MESSAGE = "This vendor is on GST Hold. Contact Admin to remove it.";

/** Pass `undefined` to skip the fetch. */
export const useVendorGstHold = (vendorId: string | undefined): VendorGstHoldState => {
    const { data, isLoading, mutate } = useFrappeGetCall<{ message: VendorGstHoldSummary }>(
        "nirmaan_stack.api.service_requests.vendor_fy_limit.get_vendor_fy_wo_total",
        { vendor: vendorId },
        vendorId ? `vendor_gst_hold_${vendorId}` : null,
        { revalidateOnFocus: false }
    );

    return useMemo(() => {
        const summary = vendorId ? data?.message : undefined;
        return {
            summary,
            isChecking: !!vendorId && isLoading,
            isOnGstHold: !!summary?.gst_hold,
            mutate: () => void mutate(),
        };
    }, [vendorId, data, isLoading, mutate]);
};
