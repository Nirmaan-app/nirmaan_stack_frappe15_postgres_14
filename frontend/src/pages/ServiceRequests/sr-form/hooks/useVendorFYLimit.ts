import { useMemo } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";
import formatToIndianRupee from "@/utils/FormatPrice";

/**
 * Vendor financial-year Work Order limit, as seen by the new-WO wizard.
 *
 * The rule (which WOs count, the FY dates, the limit, the `>` edge) is owned by the backend:
 * `nirmaan_stack/services/wo_vendor_limit.py`. The server also refuses the insert, so this
 * hook only mirrors the verdict early — a failed fetch does NOT block the user here.
 */
export interface VendorFYWOTotal {
    vendor: string;
    total: number;      // pre-GST sum of the vendor's GST-off, non-rejected WOs this FY
    wo_count: number;
    fy_start: string;   // YYYY-MM-DD
    fy_end: string;     // YYYY-MM-DD (inclusive)
    limit: number;
}

export interface VendorFYLimitState {
    summary: VendorFYWOTotal | undefined;
    isChecking: boolean;
    /** vendor total + this WO */
    projectedTotal: number;
    isOverLimit: boolean;
}

/** formatToIndianRupee renders 0 as "--"; a vendor with no WOs yet should read ₹0.00. */
export const rupees = (amount: number) => (amount ? formatToIndianRupee(amount) : "₹0.00");

/** "FY 26-27" from the endpoint's YYYY-MM-DD bounds. */
export const fyLabel = (summary: VendorFYWOTotal) =>
    `FY ${summary.fy_start.slice(2, 4)}-${summary.fy_end.slice(2, 4)}`;

/** Plain-text reason for toasts; the step renders the same facts as a card. */
export const vendorFYLimitBlockedMessage = (state: VendorFYLimitState): string => {
    if (state.isChecking) return "Checking this vendor's Work Order total. Please wait a moment.";
    const s = state.summary;
    if (!s) return "";
    return (
        `This vendor's Work Orders (GST off) in ${fyLabel(s)} total ${rupees(s.total)}; ` +
        `with this Work Order it becomes ${rupees(state.projectedTotal)}, above the ` +
        `${rupees(s.limit)} limit.`
    );
};

export const useVendorFYLimit = (vendorId: string | undefined, newWOAmount: number): VendorFYLimitState => {
    const { data, isLoading } = useFrappeGetCall<{ message: VendorFYWOTotal }>(
        "nirmaan_stack.api.service_requests.vendor_fy_limit.get_vendor_fy_wo_total",
        { vendor: vendorId },
        vendorId ? `vendor_fy_wo_total_${vendorId}` : null,
        { revalidateOnFocus: false }
    );

    return useMemo(() => {
        const summary = vendorId ? data?.message : undefined;
        const projectedTotal = (summary?.total ?? 0) + (newWOAmount || 0);
        return {
            summary,
            isChecking: !!vendorId && isLoading,
            projectedTotal,
            // Mirrors `exceeds_limit` — strictly above; exactly the limit is allowed.
            isOverLimit: !!summary && projectedTotal > summary.limit,
        };
    }, [vendorId, data, isLoading, newWOAmount]);
};
