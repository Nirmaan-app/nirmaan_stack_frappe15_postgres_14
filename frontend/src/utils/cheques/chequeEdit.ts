import type { ChequeDetail } from "@/components/cheques/useChequeDetail";
import { CHEQUE_ACCESS_PROFILES, CHEQUE_ACCOUNTS_PROFILES } from "@/constants/roles";
import { CHEQUE_STATUS, CHEQUE_TYPE, type ChequeStatus, type ChequeType } from "@/types/NirmaanStack/Cheques";

import { saveChequeArgs, type ChequeFormInput, type ChequeFormValues, type SaveChequeArgs } from "./chequeForm";
import { LINE_TYPE, saveLineArgs, type ChequeLineDraft } from "./chequeLines";

/**
 * Editing a Cheque from the Cheque Tracker (#1418, spec #1407; #1482, spec #1477), pure so vitest covers it
 * without React (F4).
 *
 * Mirrors `services/cheques/rules.edit_access_problem` and `edit_problem`, which are the enforcement:
 * this only shapes the Edit dialog (which boxes are open, the hints) and who sees the Edit button.
 *
 * - A Payment cheque's fields and lines change only while it is Pending (`EDITABLE_STATUSES`, mirroring
 *   `rules.EDITABLE_STATUSES`). Issued, Cleared and Cancelled: only its photo.
 * - An Old-type cheque (spec #1477): only its photo, whatever its status.
 * - A Pending Cheque made from the PO/WO page: while a Project Payment line is still on it, its number,
 *   date and amount stay as on its payment; its other fields and its lines can change. With no Project
 *   Payment line left, it edits like a Tracker-made Cheque.
 * - Any line can come off a Pending Cheque. A Project Payment taken off switches back to Online, its
 *   status unchanged (`rules.payments_taken_off`); the dialog says so beside the lines.
 * - A Security Deposit cheque (#1486): everything while Issued, only its photo once Cancelled.
 * - Admin, Accountant and Accountant Lead edit any Cheque; Procurement only the ones they made, a Payment
 *   cheque while Pending (C6), a deposit while Issued.
 */

/** The statuses at which a Cheque's fields and lines may still change (`rules.editable_statuses`). */
const EDITABLE_STATUSES: readonly ChequeStatus[] = [CHEQUE_STATUS.PENDING];
const DEPOSIT_EDITABLE_STATUSES: readonly ChequeStatus[] = [CHEQUE_STATUS.ISSUED];

/** What the edit rules read of a Cheque. A missing type is a Payment cheque. */
interface EditFacts {
    status: ChequeStatus;
    cheque_type?: ChequeType | string | null;
}

const isEditableStatus = ({ status, cheque_type }: EditFacts): boolean =>
    (cheque_type === CHEQUE_TYPE.SECURITY_DEPOSIT ? DEPOSIT_EDITABLE_STATUSES : EDITABLE_STATUSES).includes(status);

/** Which of a Cheque's boxes the Edit dialog opens. */
export type ChequeEditMode = "all" | "po_wo_page" | "photo_only";

/** What a PO/WO-page Cheque keeps (`rules.LOCKED_ON_PO_WO_PAGE`). */
const LOCKED_ON_PO_WO_PAGE = ["cheque_no", "cheque_date", "amount"];

export const canEditCheque = (cheque: EditFacts & { owner: string }, role: string, user: string): boolean =>
    CHEQUE_ACCOUNTS_PROFILES.includes(role) ||
    (CHEQUE_ACCESS_PROFILES.includes(role) && isEditableStatus(cheque) && cheque.owner === user);

export const chequeEditMode = (
    cheque: Pick<ChequeDetail, "status" | "made_from" | "lines" | "old_type"> & Pick<EditFacts, "cheque_type">,
): ChequeEditMode => {
    if (cheque.old_type || !isEditableStatus(cheque)) return "photo_only";
    const holdsPayment = cheque.lines.some((l) => l.line_type === LINE_TYPE.PO_WO && l.payment_name);
    return cheque.made_from === "PO/WO Page" && holdsPayment ? "po_wo_page" : "all";
};

/** The form rules for editing `cheque`: a Payment cheque's in full, or a photo-only edit's. */
export const chequeFormRules = (cheque: Pick<ChequeDetail, "status" | "made_from" | "lines" | "old_type" | "attachment">) => ({
    // A backfilled Cheque has no photo; editing it does not force one (the server asks only a new Cheque).
    photoRequired: Boolean(cheque.attachment),
    paymentCheque: chequeEditMode(cheque) !== "photo_only",
});

/** Whether the dialog locks a box: a header field's name, "lines", or "attachment" (the photo). */
export const isHeaderLocked = (mode: ChequeEditMode, field: string): boolean => {
    if (mode === "photo_only") return field !== "attachment";
    if (mode === "po_wo_page") return LOCKED_ON_PO_WO_PAGE.includes(field);
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
    if (mode === "po_wo_page") {
        return "Made from the PO/WO page: the number, date and amount stay as on its payment. Change them on the payment.";
    }
    return undefined;
};

/** The Project Payments on a Pending Cheque's lines: each one an edit takes off goes back to Online. */
export const paymentsOnCheque = (cheque: Pick<ChequeDetail, "status" | "lines">): string[] =>
    isEditableStatus(cheque)
        ? cheque.lines
              .filter((l) => l.line_type === LINE_TYPE.PO_WO && l.payment_name)
              .map((l) => l.payment_name as string)
        : [];

/** Which of the Cheque's recorded payments the edited `lines` no longer hold (removed, or swapped out). */
export const paymentsSwitchingToOnline = (
    recorded: string[],
    lines: Pick<ChequeLineDraft, "line_type" | "payment_name">[],
): string[] => {
    const kept = new Set(lines.filter((l) => l.line_type === LINE_TYPE.PO_WO).map((l) => l.payment_name));
    return recorded.filter((payment) => !kept.has(payment));
};

/** The note beside the lines for a payment the edit takes off. */
export const switchBackHint = (payment: string): string => `${payment} will switch back to Online.`;

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
        payment_status: l.payment_status ?? "",
        amount: l.amount,
    })),
});

/** The save arguments for an edit: the whole Cheque, named, with its lines even when there are none. */
export const editChequeArgs = (name: string, values: ChequeFormValues): SaveChequeArgs => ({
    ...saveChequeArgs(values),
    lines: saveLineArgs(values.lines),
    name,
});
