import { CHEQUE_ACCOUNTS_PROFILES } from "@/constants/roles";
import { PAYMENT_STATUS } from "@/constants/paymentStatus";
import { CHEQUE_BANK } from "@/types/NirmaanStack/Cheques";

/**
 * Clear and Cancel a cheque from the Cheque Tracker (#1484, spec #1477, ADR-0035). Pure, so vitest covers the
 * dialogs' logic. The server enforces the same rules (`services/cheques/rules.py`, `services/cheques/status.py`):
 *
 * - Clear (Issued only by hand): every payment becomes Paid on the clearance date. One cheque may link an
 *   imported, unmatched bank line with its number and amount; several are cleared at once on one date.
 * - Cancel (Pending or Issued): every payment becomes Rejected, with the note as their reason.
 */

export const CLEAR_CHEQUE_API = "nirmaan_stack.api.cheques.cheque_status.clear_cheque";
export const CLEAR_CHEQUES_API = "nirmaan_stack.api.cheques.cheque_status.clear_cheques";
export const CANCEL_CHEQUE_API = "nirmaan_stack.api.cheques.cheque_status.cancel_cheque";
export const CHEQUE_BANK_LINES_API = "nirmaan_stack.api.cheques.cheque_status.get_bank_lines";
export const CHEQUE_DETAIL_API = "nirmaan_stack.api.cheques.cheque_detail.get_cheque";

/** Admin, Accountant and Accountant Lead clear and cancel; Procurement never does. */
export const canClearOrCancel = (role: string): boolean => CHEQUE_ACCOUNTS_PROFILES.includes(role);

/** `YYYY-MM-DD` of a date or datetime string. */
const day = (v: string) => v.slice(0, 10);

/** Today in the browser's time zone, as `YYYY-MM-DD` (what a date input holds). */
export const todayISO = (now: Date = new Date()): string => {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

const dayText = (v: string) => day(v).split("-").reverse().join("-");

/** Why `date` cannot be the clearance date, or null: required, not after today, not before the issue date. */
export const clearanceDateProblem = (date: string, issueDate: string | null | undefined, today: string): string | null => {
    if (!date) return "Choose the clearance date.";
    if (day(date) > day(today)) return "The clearance date cannot be after today.";
    if (issueDate && day(date) < day(issueDate))
        return `The clearance date cannot be before the cheque was issued (${dayText(issueDate)}).`;
    return null;
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

/** What cancelling does, in the Cancel dialog's warning. */
export const cancelNote = (chequeNo: string, payments: number): string => {
    const who =
        payments === 0 ? "No payment changes," : payments === 1 ? "Its payment becomes Rejected," : `All ${payments} payments become Rejected,`;
    return (
        `${who} and cheque ${chequeNo} becomes Cancelled. The cheque keeps its lines and history. ` +
        "To pay the vendor later, raise new payment requests."
    );
};

/** The cheque facts the Clear dialog reads to decide whether to offer bank lines. */
export interface ClearableCheque {
    bank: string;
    old_type?: 0 | 1 | null;
}

/**
 * Does the Clear dialog look for bank lines? Only an ICICI Bank cheque is matched to a statement line, and an
 * Old-type cheque is cleared by hand without one.
 */
export const offersBankLines = (cheque: ClearableCheque): boolean => cheque.bank === CHEQUE_BANK.ICICI && !cheque.old_type;

/** An imported line the Clear dialog offers (`cheque_status.get_bank_lines`). */
export interface ChequeBankLine {
    name: string;
    added_on?: string | null;
    amount: number;
    reference_id?: string | null;
    remarks?: string | null;
    import_batch?: string | null;
}

/** Picking a line clears the cheque on the day the bank paid it. */
export const clearanceDateOf = (line: ChequeBankLine): string | null => (line.added_on ? day(line.added_on) : null);

export interface ChequeCleared {
    cheque: string;
    cheque_no?: string | null;
    payments?: string[];
}

export interface ChequeSkipped {
    cheque: string;
    cheque_no?: string | null;
    reason: string;
}

/** What `clear_cheques` returns, for a clear or its preview. */
export interface ChequesClearedResult {
    changed: ChequeCleared[];
    skipped: ChequeSkipped[];
}

/** "5 cleared, 1 skipped: 004521 already Cleared". */
export const bulkClearText = ({ changed, skipped }: ChequesClearedResult): string => {
    const head = `${changed.length} cleared`;
    if (!skipped.length) return head;
    const reasons = skipped.map((s) => `${s.cheque_no || s.cheque} ${s.reason}`).join("; ");
    return `${head}, ${skipped.length} skipped: ${reasons}`;
};
