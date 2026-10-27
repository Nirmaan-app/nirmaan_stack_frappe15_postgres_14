import { useFrappeEventListener, useFrappeGetCall } from "frappe-react-sdk";

import {
    CHEQUES_CHANGED_EVENT,
    type ChequeBank,
    type ChequeLineType,
    type ChequeMadeFrom,
    type ChequeStatus,
    type ChequeType,
} from "@/types/NirmaanStack/Cheques";
import { CHEQUE_DETAIL_API } from "@/utils/cheques/chequeStatus";

export interface ChequeDetailLine {
    idx: number;
    line_type: ChequeLineType;
    project?: string | null;
    project_name?: string | null;
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
    /** The Cheque/Payment Date: the paper date, then the day the bank paid it (#1520). */
    cheque_date: string;
    amount: number;
    status: ChequeStatus;
    cheque_type: ChequeType;
    /** 1 for a Cheque from before cheque types (spec #1477): only its photo can change. */
    old_type?: 0 | 1;
    issue_date?: string | null;
    bank_line?: string | null;
    /** The imported bank line that cleared it (#1484). */
    bank_line_detail?: {
        name: string;
        added_on?: string | null;
        amount: number;
        reference_id?: string | null;
        import_batch?: string | null;
    } | null;
    vendor?: string | null;
    vendor_name?: string | null;
    payee_name?: string | null;
    description?: string | null;
    attachment?: string | null;
    made_from: ChequeMadeFrom;
    lines: ChequeDetailLine[];
    history: ChequeDetailHistory[];
}

/** The detail view's cache key for one Cheque: revalidate it after changing that Cheque. */
export const chequeDetailKey = (name: string) => `cheque-detail-${name}`;

/** The Cheque named `name` for the detail view, refetched whenever any Cheque changes. Idle when null. */
export const useChequeDetail = (name: string | null) => {
    const { data, error, isLoading, mutate } = useFrappeGetCall<{ message: ChequeDetail }>(
        CHEQUE_DETAIL_API,
        { name },
        name ? chequeDetailKey(name) : null,
    );
    useFrappeEventListener(CHEQUES_CHANGED_EVENT, () => {
        if (name) mutate();
    });
    return { cheque: data?.message, error, isLoading, refetch: mutate };
};
