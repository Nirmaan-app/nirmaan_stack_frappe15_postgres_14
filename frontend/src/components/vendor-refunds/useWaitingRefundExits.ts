import { useFrappePostCall } from "frappe-react-sdk";
import { useRefreshPORefundViews } from "./useRefreshPORefundViews";
import type { RefundEdit } from "./waitingRefundExits";

const API = "nirmaan_stack.api.vendor_refunds.waiting_refunds";

/** What cancel and mark answer: the refund, its status, and its PO's held and spendable credit. */
interface ExitResult {
    refund: string;
    status: string;
    held_credit: number;
    usable_credit: number;
}

interface EditResult {
    refund: string;
    status: string;
    amount: number;
    po_id: string;
}

/**
 * Edit a Vendor Refund, cancel a waiting one, or mark it Received with no bank line (#1403), from a
 * PO's Transaction Details. The server gates all three (`waiting_refunds`). Afterwards every view of the
 * PO the refund moves is refreshed (`useRefreshPORefundViews`), both POs when an edit moves it.
 */
export function useWaitingRefundExits(poId: string) {
    const refresh = useRefreshPORefundViews();
    const cancelCall = useFrappePostCall<{ message: ExitResult }>(`${API}.cancel_waiting_refund`);
    const markCall = useFrappePostCall<{ message: ExitResult }>(`${API}.mark_received_without_bank_line`);
    const editCall = useFrappePostCall<{ message: EditResult }>(`${API}.update_waiting_refund`);

    const cancel = async (refund: string) => {
        const res = await cancelCall.call({ refund });
        await refresh(poId);
        return res?.message;
    };

    const markReceived = async (refund: string, reason: string) => {
        const res = await markCall.call({ refund, reason });
        await refresh(poId);
        return res?.message;
    };

    const edit = async (refund: string, changes: RefundEdit) => {
        const res = await editCall.call({ refund, ...changes });
        const movedTo = res?.message?.po_id;
        await Promise.all([refresh(poId), movedTo && movedTo !== poId ? refresh(movedTo) : null]);
        return res?.message;
    };

    return {
        cancel,
        markReceived,
        edit,
        loading: cancelCall.loading || markCall.loading || editCall.loading,
    };
}
