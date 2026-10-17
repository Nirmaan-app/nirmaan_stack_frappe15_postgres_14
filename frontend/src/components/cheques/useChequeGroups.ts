import { useMemo } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";

import type { ChequeApproval, ChequeApprovalStage } from "@/utils/cheques/chequeApproval";
import { CHEQUE_GROUPS_API } from "@/utils/cheques/chequeBulk";

/**
 * The Pending cheques a bulk selection's payments are on, each with every line (#1481): what the bulk dialog
 * shows as locked cheque groups. Idle (no request) when `paymentIds` is empty.
 */
export const useChequeGroups = (paymentIds: readonly string[], stage: ChequeApprovalStage) => {
    const ids = useMemo(() => [...paymentIds].sort(), [paymentIds]);
    const key = ids.length ? `cheque-groups-${stage}-${ids.join(",")}` : null;
    const { data, error, isLoading } = useFrappeGetCall<{ message: ChequeApproval[] }>(
        CHEQUE_GROUPS_API,
        { payment_ids: JSON.stringify(ids), stage },
        key,
    );
    return { groups: data?.message ?? [], error, isLoading: !!key && isLoading };
};
