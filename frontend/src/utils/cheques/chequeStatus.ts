import { CHEQUE_ACCOUNTS_PROFILES } from "@/constants/roles";
import { PAYMENT_STATUS } from "@/constants/paymentStatus";

/**
 * Cancel a cheque from the Cheque Tracker (#1484, spec #1477, ADR-0035). Pure, so vitest covers the dialog's
 * logic. The server enforces the same rules (`services/cheques/clear_rules.py`, `services/cheques/status.py`):
 *
 * - Cancel (Approval Pending or Issued): every payment becomes Rejected, with the note as their reason.
 * - A cheque with a line already Paid is never cancelled: the money has left the bank (owner, 2026-10-22).
 * - There is no Clear (#1516, ADR-0035 Amendment A): only an imported bank-statement line clears a cheque.
 */

export const CANCEL_CHEQUE_API = "nirmaan_stack.api.cheques.cheque_status.cancel_cheque";
export const CHEQUE_DETAIL_API = "nirmaan_stack.api.cheques.cheque_detail.get_cheque";

/** Admin, Accountant and Accountant Lead cancel; Procurement never does. */
export const canCancelCheques = (role: string): boolean => CHEQUE_ACCOUNTS_PROFILES.includes(role);

/** Today in the browser's time zone, as `YYYY-MM-DD` (what a date input holds). */
export const todayISO = (now: Date = new Date()): string => {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

/** Cancelling rejects every payment with the note as their reason, so it is required. */
export const cancelNoteProblem = (note: string): string | null =>
    note.trim() ? null : "Write a note saying why the cheque is cancelled.";

/** A cheque's line as the Cancel dialog reads it (`cheque_detail.get_cheque`). */
export interface ChequePaymentLine {
    payment_doctype?: string | null;
    payment_name?: string | null;
    payment_status?: string | null;
    amount: number;
}

/** The payments a Cancel turns Rejected: every payment on the cheque not Rejected already. */
export const paymentsRejectedByCancel = <T extends ChequePaymentLine>(lines: T[]): T[] =>
    lines.filter(
        (l) => l.payment_doctype === "Project Payments" && !!l.payment_name && l.payment_status !== PAYMENT_STATUS.REJECTED,
    );

/** Why a cheque with a line already Paid cannot be cancelled, after its kind and name (`clear_rules.PAID_LINE_CANCEL_REASON`). */
export const PAID_LINE_CANCEL_REASON = "on it is already Paid, so the money has left the bank";

/**
 * Why a cheque with these lines cannot be cancelled, or null: its first line already Paid, a payment or an
 * Old-type cheque's expense (`clear_rules.cancel_problem`, which refuses the same on the server).
 */
export const paidLineCancelProblem = (lines: ChequePaymentLine[]): string | null => {
    const paid = lines.find((l) => !!l.payment_name && l.payment_status === PAYMENT_STATUS.PAID);
    if (!paid) return null;
    const kind = paid.payment_doctype === "Project Payments" ? "payment" : "expense";
    return `${kind} ${paid.payment_name} ${PAID_LINE_CANCEL_REASON}`;
};

/** What cancelling does, in the Cancel dialog's warning. */
export const cancelNote = (chequeNo: string, payments: number): string => {
    const who =
        payments === 0 ? "No payment changes," : payments === 1 ? "Its payment becomes Rejected," : `All ${payments} payments become Rejected,`;
    return (
        `${who} and cheque ${chequeNo} becomes Cancelled. The cheque keeps its lines and history. ` +
        "To pay the vendor later, raise new payment requests."
    );
};
