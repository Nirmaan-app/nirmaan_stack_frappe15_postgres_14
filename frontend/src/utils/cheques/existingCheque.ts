/**
 * The reply of `api/cheques/find_cheque.find_cheque` (#1414), parsed at this one accessor (F2): the
 * Cheque already recorded with a bank + cheque number, and the Request Payment refusal word for word.
 */
export interface ExistingCheque {
    cheque: string;
    cheque_no: string;
    bank_label: string;
    status: string;
    /** What Submit would be refused with. */
    message: string;
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** The Cheque the reply names, or null when the bank + number is free (or the reply is not one). */
export const parseExistingCheque = (message: unknown): ExistingCheque | null => {
    if (!message || typeof message !== "object") return null;
    const reply = message as Record<string, unknown>;
    if (!text(reply.cheque)) return null;
    return {
        cheque: text(reply.cheque),
        cheque_no: text(reply.cheque_no),
        bank_label: text(reply.bank_label),
        status: text(reply.status),
        message: text(reply.message),
    };
};
