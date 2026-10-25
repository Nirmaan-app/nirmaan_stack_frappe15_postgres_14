import type { ChequeDetail } from "@/components/cheques/useChequeDetail";
import { CHEQUE_ACCESS_PROFILES, CHEQUE_ACCOUNTS_PROFILES } from "@/constants/roles";
import {
    CHEQUE_BANK,
    CHEQUE_STATUS,
    CHEQUE_TYPE,
    type ChequeBank,
    type ChequeStatus,
    type ChequeType,
} from "@/types/NirmaanStack/Cheques";

import { saveChequeArgs, type ChequeFormInput, type ChequeFormValues, type SaveChequeArgs } from "./chequeForm";

/**
 * Editing a Cheque from the Cheque Tracker (#1418, spec #1407; #1482, spec #1477; spec #1514), pure so vitest
 * covers it without React (F4).
 *
 * Mirrors `services/cheques/edit_rules.edit_access_problem` and `edit_problem`, which are the enforcement:
 * this only shapes the Edit dialog (which boxes are open, the hint) and who sees the Edit button.
 *
 * - An Approval Pending Payment cheque: only what is written on the paper changes, its number, bank, date and photo
 *   (`PAYMENT_CHEQUE_FIELDS`, mirroring `edit_rules.PAYMENT_CHEQUE_EDITABLE_FIELDS`). Its amount, payee, note
 *   and lines are what it pays, and stay as made: the dialog shows its lines and never sends them.
 * - Issued, Cleared and Cancelled: only its photo. An Old-type cheque (spec #1477): only its photo, whatever
 *   its status.
 * - A Security Deposit cheque (#1486): everything while Issued, only its photo once Cancelled.
 * - Admin, Accountant and Accountant Lead edit any Cheque; Procurement only the ones they made, a Payment
 *   cheque while Approval Pending (C6), a deposit while Issued.
 */

/** The statuses at which a Cheque may change more than its photo (`edit_rules.editable_statuses`). */
const EDITABLE_STATUSES: readonly ChequeStatus[] = [CHEQUE_STATUS.PENDING];
const DEPOSIT_EDITABLE_STATUSES: readonly ChequeStatus[] = [CHEQUE_STATUS.ISSUED];

/** What an Approval Pending Payment cheque's Edit opens: what is written on the paper, and its photo. */
const PAYMENT_CHEQUE_FIELDS = ["bank", "bank_name", "cheque_no", "cheque_date", "attachment"];

/** What the edit rules read of a Cheque. A missing type is a Payment cheque. */
interface EditFacts {
    status: ChequeStatus;
    cheque_type?: ChequeType | string | null;
}

const isDeposit = ({ cheque_type }: Pick<EditFacts, "cheque_type">): boolean => cheque_type === CHEQUE_TYPE.SECURITY_DEPOSIT;

const isEditableStatus = (cheque: EditFacts): boolean =>
    (isDeposit(cheque) ? DEPOSIT_EDITABLE_STATUSES : EDITABLE_STATUSES).includes(cheque.status);

/**
 * Which of a Cheque's boxes the Edit dialog opens: all of an Issued deposit's, an Approval Pending Payment cheque's
 * header (`PAYMENT_CHEQUE_FIELDS`), or only the photo.
 */
export type ChequeEditMode = "all" | "header" | "photo_only";

export const canEditCheque = (cheque: EditFacts & { owner: string }, role: string, user: string): boolean =>
    CHEQUE_ACCOUNTS_PROFILES.includes(role) ||
    (CHEQUE_ACCESS_PROFILES.includes(role) && isEditableStatus(cheque) && cheque.owner === user);

export const chequeEditMode = (cheque: Pick<ChequeDetail, "status" | "old_type"> & Pick<EditFacts, "cheque_type">): ChequeEditMode => {
    if (cheque.old_type || !isEditableStatus(cheque)) return "photo_only";
    return isDeposit(cheque) ? "all" : "header";
};

/**
 * The banks a Cheque's Edit offers. A Payment cheque is drawn on ICICI Bank, the only bank whose statement
 * clears it (#1516, `rules.header_problem`); a Security Deposit cheque is never cleared, so it may be on Others.
 */
export const chequeBankOptions = (cheque: Pick<EditFacts, "cheque_type">): readonly ChequeBank[] =>
    isDeposit(cheque) ? [CHEQUE_BANK.ICICI, CHEQUE_BANK.OTHERS] : [CHEQUE_BANK.ICICI];

/** The form rules for editing `cheque`. A backfilled Cheque has no photo; editing it does not force one. */
export const chequeFormRules = (cheque: Pick<ChequeDetail, "attachment">) => ({
    photoRequired: Boolean(cheque.attachment),
});

/** Whether the dialog locks a box: a header field's name, "lines", or "attachment" (the photo). */
export const isHeaderLocked = (mode: ChequeEditMode, field: string): boolean => {
    if (mode === "photo_only") return field !== "attachment";
    if (mode === "header") return !PAYMENT_CHEQUE_FIELDS.includes(field);
    return false;
};

/** The note at the top of the Edit dialog saying what is locked, if anything is. */
export const editLockHint = (
    mode: ChequeEditMode,
    cheque: Pick<ChequeDetail, "status" | "old_type">,
): string | undefined => {
    if (mode === "photo_only") {
        return cheque.old_type
            ? "This is an Old-type cheque: only its photo can change."
            : `This cheque is ${cheque.status}: only its photo can change.`;
    }
    if (mode === "header") {
        return (
            "Only what is written on the cheque can change: its number, bank, date and photo. What it pays stays as " +
            "it was made; to pay something else, cancel it and raise the payment again from the PO."
        );
    }
    return undefined;
};

/** The Edit dialog's starting values: the Cheque's header as recorded. */
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
});

/** The save arguments for an edit: the Cheque's header, named. No lines: the server keeps them as they are. */
export const editChequeArgs = (name: string, values: ChequeFormValues): SaveChequeArgs => ({
    ...saveChequeArgs(values),
    name,
});
