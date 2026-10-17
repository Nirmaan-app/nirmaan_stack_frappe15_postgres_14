import { useFrappeEventListener, useFrappeGetCall } from "frappe-react-sdk";

import { CHEQUES_CHANGED_EVENT } from "@/types/NirmaanStack/Cheques";
import {
    CHEQUE_APPROVAL_API,
    type ChequeApproval,
    type ChequeApprovalStage,
} from "@/utils/cheques/chequeApproval";

/**
 * The cheque `paymentId` is on, as the approval dialog shows it (#1480): every line, the cheque total, where
 * L1 lands it and why it cannot be approved yet. `approval` is null for a payment on no Payment cheque.
 * Idle when `paymentId` is null; refetched whenever any Cheque changes.
 */
export const useChequeApproval = (paymentId: string | null, stage: ChequeApprovalStage) => {
    const { data, error, isLoading, mutate } = useFrappeGetCall<{ message: ChequeApproval | null }>(
        CHEQUE_APPROVAL_API,
        { payment_id: paymentId, stage },
        paymentId ? `cheque-approval-${stage}-${paymentId}` : null,
    );
    useFrappeEventListener(CHEQUES_CHANGED_EVENT, () => {
        if (paymentId) mutate();
    });
    return { approval: data?.message ?? null, error, isLoading };
};
