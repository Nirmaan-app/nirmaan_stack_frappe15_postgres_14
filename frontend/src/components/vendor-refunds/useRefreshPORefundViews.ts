import { useCallback } from "react";
import { useSWRConfig as useFrappeSWRConfig } from "frappe-react-sdk";
import { useSWRConfig } from "swr";
import { poAdjustmentKeys } from "@/pages/POAdjustment/data/poAdjustment.constants";
import { poRefundLinksKey } from "@/pages/POAdjustment/data/usePORefundLinks";
import { poRevisionKeys } from "@/pages/PORevision/data/poRevision.constants";
import { poRefundsTarget, vendorRefundsKey } from "./useVendorRefunds";

/**
 * After any write to a PO's Vendor Refund (record, edit, cancel, mark received, delete), refresh every
 * view of the PO the refund moves: its refund rows, the payment lock, the PO Adjustment (balance, held
 * credit) and the refund links behind the over-balance warning. One list, so no writer forgets one.
 *
 * ⚠️ TWO SWR CACHES. `frappe-react-sdk` bundles its own SWR, so its hooks (`useFrappeGetCall`, here the
 * refund rows) live in a cache the app's `swr` `mutate` never reaches. The lock, adjustment and refund
 * links read through the app's `swr`. Each key is refreshed through the cache that holds it.
 */
export function useRefreshPORefundViews() {
    const { mutate: mutateFrappe } = useFrappeSWRConfig();
    const { mutate } = useSWRConfig();
    return useCallback(
        (poId: string) =>
            Promise.all([
                mutateFrappe(vendorRefundsKey(poRefundsTarget(poId))),
                mutate(poRevisionKeys.lockCheck(poId)),
                mutate(poAdjustmentKeys.adjustmentDoc(poId)),
                mutate(poRefundLinksKey(poId)),
            ]),
        [mutateFrappe, mutate]
    );
}
