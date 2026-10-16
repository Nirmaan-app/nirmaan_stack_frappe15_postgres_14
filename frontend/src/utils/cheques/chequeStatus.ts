import { CHEQUE_ACCOUNTS_PROFILES } from "@/constants/roles";
import { CHEQUE_STATUS, type ChequeStatus } from "@/types/NirmaanStack/Cheques";

/**
 * A Cheque's status by hand (#1412, spec #1407). Pure. The server enforces the same rules
 * (`services/cheques/status.py`): Cancel needs a note; a Cheque with a Paid payment cannot be
 * cancelled; leaving Cancelled is refused while a payment is on another live Cheque.
 */

export const CHEQUE_STATUS_API = "nirmaan_stack.api.cheques.cheque_status.change_cheque_status";
export const CHEQUE_STATUSES_API = "nirmaan_stack.api.cheques.cheque_status.change_cheque_statuses";
export const CHEQUE_DETAIL_API = "nirmaan_stack.api.cheques.cheque_detail.get_cheque";

const ALL: ChequeStatus[] = [CHEQUE_STATUS.ISSUED, CHEQUE_STATUS.CLEARED, CHEQUE_STATUS.CANCELLED];

/** The statuses a Cheque at `current` can move to: the other two. Every one for a mixed selection. */
export const statusTargets = (current: ChequeStatus | undefined): ChequeStatus[] =>
    ALL.filter((s) => s !== current);

/** Why the note blocks the move, or null. A note is required only to Cancel. */
export const noteProblem = (target: ChequeStatus, note: string): string | null =>
    target === CHEQUE_STATUS.CANCELLED && !note.trim() ? "Write a note saying why the cheque is cancelled." : null;

/** Admin, Accountant and Accountant Lead change status; Procurement never does. */
export const canChangeChequeStatus = (role: string): boolean => CHEQUE_ACCOUNTS_PROFILES.includes(role);

export interface ChequeMoved {
    cheque: string;
    cheque_no?: string | null;
    from_status?: ChequeStatus;
    /** The payments a Cancel leaves at Reconciliation Pending. */
    reconciliation_pending?: string[];
}

export interface ChequeSkipped {
    cheque: string;
    cheque_no?: string | null;
    reason: string;
}

/** What `change_cheque_statuses` returns, for a change or its preview. */
export interface ChequeStatusesResult {
    changed: ChequeMoved[];
    skipped: ChequeSkipped[];
}

/** "5 changed, 1 skipped: 004521 already Cleared". */
export const bulkResultText = ({ changed, skipped }: ChequeStatusesResult): string => {
    const head = `${changed.length} changed`;
    if (!skipped.length) return head;
    const reasons = skipped.map((s) => `${s.cheque_no || s.cheque} ${s.reason}`).join("; ");
    return `${head}, ${skipped.length} skipped: ${reasons}`;
};

/** The payments a Cancel would leave at Reconciliation Pending, across the moved cheques. */
export const pendingAfterCancel = (changed: ChequeMoved[]): string[] =>
    changed.flatMap((c) => c.reconciliation_pending ?? []);
