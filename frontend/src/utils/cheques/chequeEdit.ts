import type { ChequeDetail } from "@/components/cheques/useChequeDetail";
import { CHEQUE_ACCESS_PROFILES, CHEQUE_ACCOUNTS_PROFILES } from "@/constants/roles";
import { CHEQUE_STATUS, type ChequeMadeFrom, type ChequeStatus } from "@/types/NirmaanStack/Cheques";

import { saveChequeArgs, type ChequeFormInput, type ChequeFormValues, type SaveChequeArgs } from "./chequeForm";
import { LINE_TYPE, saveLineArgs } from "./chequeLines";

/**
 * Editing a Cheque from the report (#1418, spec #1407), pure so vitest covers it without React (F4).
 *
 * Mirrors `services/cheques/rules.edit_access_problem` and `edit_problem`, which are the enforcement:
 * this only shapes the Edit dialog (which boxes are open, the hints) and who sees the Edit button.
 *
 * - An Issued Cheque made on the report: everything can change.
 * - An Issued Cheque made from the PO/WO page: its number, date and amount stay as on its payment;
 *   its other fields and its lines can change.
 * - A Cleared or Cancelled Cheque: only its photo.
 * - A line holding a Project Payment cannot come off an Issued Cheque; lines with no payment and
 *   expense lines can.
 * - Admin, Accountant and Accountant Lead edit any Cheque; Procurement only the Issued ones they made.
 */

/** Which of a Cheque's boxes the Edit dialog opens. */
export type ChequeEditMode = "all" | "po_wo_page" | "photo_only";

/** What a PO/WO-page Cheque keeps (`rules.LOCKED_ON_PO_WO_PAGE`). */
const LOCKED_ON_PO_WO_PAGE = ["cheque_no", "cheque_date", "amount"];

/** Why a payment line's remove button is off. Matches the server's refusal. */
export const LOCKED_LINE_HINT =
    "A payment on an Issued cheque cannot be taken off: reject the payment, or cancel the cheque and Switch to Online.";

export const canEditCheque = (cheque: { status: ChequeStatus; owner: string }, role: string, user: string): boolean =>
    CHEQUE_ACCOUNTS_PROFILES.includes(role) ||
    (CHEQUE_ACCESS_PROFILES.includes(role) && cheque.status === CHEQUE_STATUS.ISSUED && cheque.owner === user);

export const chequeEditMode = (cheque: { status: ChequeStatus; made_from: ChequeMadeFrom }): ChequeEditMode => {
    if (cheque.status !== CHEQUE_STATUS.ISSUED) return "photo_only";
    return cheque.made_from === "PO/WO Page" ? "po_wo_page" : "all";
};

/** Whether the dialog locks a box: a header field's name, "lines", or "attachment" (the photo). */
export const isHeaderLocked = (mode: ChequeEditMode, field: string): boolean => {
    if (mode === "photo_only") return field !== "attachment";
    if (mode === "po_wo_page") return LOCKED_ON_PO_WO_PAGE.includes(field);
    return false;
};

/** The note at the top of the Edit dialog saying what is locked, if anything is. */
export const editLockHint = (mode: ChequeEditMode, status: ChequeStatus): string | undefined => {
    if (mode === "photo_only") return `This cheque is ${status}: only its photo can change.`;
    if (mode === "po_wo_page") {
        return "Made from the PO/WO page: the number, date and amount stay as on its payment. Change them on the payment.";
    }
    return undefined;
};

/** The Project Payments on an Issued Cheque's lines: their lines cannot come off, nor change payment. */
export const lockedLinePayments = (cheque: Pick<ChequeDetail, "status" | "lines">): string[] =>
    cheque.status === CHEQUE_STATUS.ISSUED
        ? cheque.lines
              .filter((l) => l.line_type === LINE_TYPE.PO_WO && l.payment_name)
              .map((l) => l.payment_name as string)
        : [];

/** The Edit dialog's starting values: the Cheque as recorded. */
export const chequeFormFromDetail = (d: ChequeDetail): ChequeFormInput => ({
    bank: d.bank,
    bank_name: d.bank_name ?? "",
    cheque_no: d.cheque_no,
    cheque_date: d.cheque_date,
    amount: d.amount,
    payee_kind: d.vendor ? "vendor" : "typed",
    vendor: d.vendor ?? "",
    payee_name: d.payee_name ?? "",
    attachment: d.attachment ?? "",
    description: d.description ?? "",
    lines: d.lines.map((l) => ({
        line_type: l.line_type,
        project: l.project ?? "",
        record_doctype: l.record_doctype ?? "",
        record_name: l.record_name ?? "",
        payment_name: l.payment_name ?? "",
        amount: l.amount,
    })),
});

/** The save arguments for an edit: the whole Cheque, named, with its lines even when there are none. */
export const editChequeArgs = (name: string, values: ChequeFormValues): SaveChequeArgs => ({
    ...saveChequeArgs(values),
    lines: saveLineArgs(values.lines),
    name,
});
