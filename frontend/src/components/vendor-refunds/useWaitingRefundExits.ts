import { useFrappePostCall } from "frappe-react-sdk";
import { useSWRConfig } from "swr";
import { poAdjustmentKeys } from "@/pages/POAdjustment/data/poAdjustment.constants";
import { poRefundLinksKey } from "@/pages/POAdjustment/data/usePORefundLinks";
import { poRevisionKeys } from "@/pages/PORevision/data/poRevision.constants";
import { vendorRefundsKey } from "./useVendorRefunds";

const API = "nirmaan_stack.api.vendor_refunds.waiting_refunds";

/** What both endpoints answer: the refund, its status, and its PO's held and spendable credit. */
interface ExitResult {
    refund: string;
    status: string;
    held_credit: number;
    usable_credit: number;
}

/**
 * Cancel a waiting Vendor Refund, or mark it Received with no bank line (#1403), from a PO's
 * Transaction Details. The server gates both (creator or Accountant; Admin with a reason). Afterwards
 * every view of the PO that the refund moves is refreshed: its refund rows, the payment lock, the
 * PO Adjustment (balance, held credit) and the refund links behind the over-balance warning.
 */
export function useWaitingRefundExits(poId: string) {
    const { mutate } = useSWRConfig();
    const cancelCall = useFrappePostCall<{ message: ExitResult }>(`${API}.cancel_waiting_refund`);
    const markCall = useFrappePostCall<{ message: ExitResult }>(`${API}.mark_received_without_bank_line`);

    const refresh = () =>
        Promise.all([
            mutate(vendorRefundsKey({ documentType: "Procurement Orders", documentName: poId })),
            mutate(poRevisionKeys.lockCheck(poId)),
            mutate(poAdjustmentKeys.adjustmentDoc(poId)),
            mutate(poRefundLinksKey(poId)),
        ]);

    const cancel = async (refund: string) => {
        const res = await cancelCall.call({ refund });
        await refresh();
        return res?.message;
    };

    const markReceived = async (refund: string, reason: string) => {
        const res = await markCall.call({ refund, reason });
        await refresh();
        return res?.message;
    };

    return { cancel, markReceived, loading: cancelCall.loading || markCall.loading };
}
