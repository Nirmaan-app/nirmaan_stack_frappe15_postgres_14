import { useCallback } from "react";
import { useSWRConfig } from "swr";
import { poAdjustmentKeys } from "@/pages/POAdjustment/data/poAdjustment.constants";
import { poRefundLinksKey } from "@/pages/POAdjustment/data/usePORefundLinks";
import { poRevisionKeys } from "@/pages/PORevision/data/poRevision.constants";
import { poRefundsTarget, vendorRefundsKey } from "./useVendorRefunds";

/**
 * After any write to a PO's Vendor Refund (record, edit, cancel, mark received), refresh every view of
 * the PO the refund moves: its refund rows, the payment lock, the PO Adjustment (balance, held credit)
 * and the refund links behind the over-balance warning. One list, so no writer forgets one.
 */
export function useRefreshPORefundViews() {
    const { mutate } = useSWRConfig();
    return useCallback(
        (poId: string) =>
            Promise.all([
                mutate(vendorRefundsKey(poRefundsTarget(poId))),
                mutate(poRevisionKeys.lockCheck(poId)),
                mutate(poAdjustmentKeys.adjustmentDoc(poId)),
                mutate(poRefundLinksKey(poId)),
            ]),
        [mutate]
    );
}
