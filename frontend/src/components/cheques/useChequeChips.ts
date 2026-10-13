import { useFrappeEventListener, useFrappeGetCall } from "frappe-react-sdk";

import type { ChequeStatus } from "@/types/NirmaanStack/Cheques";
import { CHEQUE_CHIPS_API } from "@/utils/cheques/chequeChip";

/** Published by the backend after every Cheque write. */
const CHEQUES_CHANGED_EVENT = "cheques:changed";

export interface ChequeChipFacts {
    cheque_no: string;
    status: ChequeStatus;
}

/**
 * The chip's number and status for the Cheques a page of payments is on (#1415, spec #1407): one call per
 * page, refetched when any Cheque changes. For lists that hold only each payment's `cheque` link (Vendor ›
 * Payments, the Transaction Details cards); the payment queues already carry both. Idle with no names.
 */
export const useChequeChips = (cheques: (string | null | undefined)[]) => {
    const names = [...new Set(cheques.filter((n): n is string => !!n))].sort();
    const key = names.join(",");
    const { data, mutate } = useFrappeGetCall<{ message: Record<string, ChequeChipFacts> }>(
        CHEQUE_CHIPS_API,
        { cheques: JSON.stringify(names) },
        key ? `cheque-chips-${key}` : null,
    );
    useFrappeEventListener(CHEQUES_CHANGED_EVENT, () => {
        if (key) mutate();
    });
    return data?.message ?? {};
};
