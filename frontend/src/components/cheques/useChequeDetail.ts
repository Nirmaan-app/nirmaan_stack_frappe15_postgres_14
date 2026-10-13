import { useFrappeEventListener, useFrappeGetCall } from "frappe-react-sdk";

import type { ChequeBank, ChequeLineType, ChequeMadeFrom, ChequeStatus } from "@/types/NirmaanStack/Cheques";
import { CHEQUE_DETAIL_API } from "@/utils/cheques/chequeStatus";

/** Published by the backend after every Cheque write. */
const CHEQUES_CHANGED_EVENT = "cheques:changed";

export interface ChequeDetailLine {
    idx: number;
    line_type: ChequeLineType;
    project?: string | null;
    record_doctype?: string | null;
    record_name?: string | null;
    payment_doctype?: string | null;
    payment_name?: string | null;
    /** The payment's status now (Project Payments and expenses). */
    payment_status?: string | null;
    amount: number;
}

export interface ChequeDetailHistory {
    from_status?: ChequeStatus | null;
    to_status: ChequeStatus;
    changed_by: string;
    changed_by_name?: string | null;
    changed_at: string;
    note?: string | null;
}

/** One Cheque as `api/cheques/cheque_detail.get_cheque` sends it; `history` oldest first. */
export interface ChequeDetail {
    name: string;
    creation: string;
    owner: string;
    owner_name?: string | null;
    cheque_no: string;
    bank: ChequeBank;
    bank_name?: string | null;
    bank_label: string;
    cheque_date: string;
    amount: number;
    status: ChequeStatus;
    vendor?: string | null;
    vendor_name?: string | null;
    payee_name?: string | null;
    description?: string | null;
    attachment?: string | null;
    made_from: ChequeMadeFrom;
    lines: ChequeDetailLine[];
    history: ChequeDetailHistory[];
}

/** The Cheque named `name` for the detail view, refetched whenever any Cheque changes. Idle when null. */
export const useChequeDetail = (name: string | null) => {
    const { data, error, isLoading, mutate } = useFrappeGetCall<{ message: ChequeDetail }>(
        CHEQUE_DETAIL_API,
        { name },
        name ? `cheque-detail-${name}` : null,
    );
    useFrappeEventListener(CHEQUES_CHANGED_EVENT, () => {
        if (name) mutate();
    });
    return { cheque: data?.message, error, isLoading, refetch: mutate };
};
