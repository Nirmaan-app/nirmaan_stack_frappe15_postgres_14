import { CHEQUE_ACCESS_PROFILES } from "@/constants/roles";
import { PAYMENT_STATUS } from "@/pages/ProjectPayments/approve-payments/constants";
import { isChequePayment } from "@/pages/ProjectPayments/paymentMode";
import { CHEQUE_STATUS } from "@/types/NirmaanStack/Cheques";

import { conversionHint } from "./chequeLines";
import type { ExistingCheque } from "./existingCheque";

/**
 * The cheque buttons on a payment in the PO / Work Order page's Transaction Details (#1416, spec #1407),
 * pure so vitest covers them without React (F4). The server refuses the same
 * (`services/cheques/rules.new_payment_cheque_problem`, `switch_to_online_problem`).
 */

const API = "nirmaan_stack.api.cheques.payment_cheque_actions";
/** Convert to Cheque and Link a new cheque: a new one-line Cheque for the payment. */
export const PUT_ON_NEW_CHEQUE_API = `${API}.put_payment_on_new_cheque`;
export const SWITCH_TO_ONLINE_API = `${API}.switch_payment_to_online`;

/** What the buttons need to know about one payment row. */
export interface PaymentChequeFacts {
    status?: string | null;
    mode_of_payment?: string | null;
    /** The Cheque the payment is on (its `cheque` link); blank on a Cheque payment no Cheque holds. */
    cheque?: string | null;
    /** That Cheque's status (`useChequeChips`); blank until it loads. */
    chequeStatus?: string | null;
}

/** Which of the three buttons a payment shows. Each opens on its own; none shows on a Rejected Online payment. */
export interface PaymentChequeButtons {
    /** An Online payment that is not Rejected. */
    convert: boolean;
    /**
     * A Cheque payment, not Rejected, whose Cheque is Cancelled (a new Cheque, the old one kept as history)
     * or that is on no Cheque (a number the backfill refused).
     */
    linkNew: boolean;
    /** A Cheque payment whose Cheque is Cancelled, or that is on no Cheque and not Rejected: back to Online, its status unchanged. */
    switchOnline: boolean;
}

const NONE: PaymentChequeButtons = { convert: false, linkNew: false, switchOnline: false };

/** The buttons for `role` on this payment: Admin, Accountants and Procurement only (`CHEQUE_ACCESS_PROFILES`). */
export const paymentChequeButtons = (p: PaymentChequeFacts, role: string): PaymentChequeButtons => {
    if (!CHEQUE_ACCESS_PROFILES.includes(role)) return NONE;
    const rejected = p.status === PAYMENT_STATUS.REJECTED;
    if (!isChequePayment(p)) return { ...NONE, convert: !rejected };
    if (!p.cheque) return { convert: false, linkNew: !rejected, switchOnline: !rejected };
    const cancelled = p.chequeStatus === CHEQUE_STATUS.CANCELLED;
    return { convert: false, linkNew: cancelled && !rejected, switchOnline: cancelled };
};

/**
 * The Convert / Link a new cheque dialog's line on what happens to the payment's status: Approved moves
 * to Reconciliation Pending now (after release when on hold), a waiting one once approved, a settled one stays.
 */
export const newChequeStatusHint = (p: { status: string; mode_of_payment?: string | null; on_hold?: number | null }): string =>
    conversionHint({ status: p.status, mode_of_payment: p.mode_of_payment ?? "", on_hold: p.on_hold ?? 0 });

/**
 * Is the Work Order's TDS still to be withheld from this payment? Only while it waits for approval: the
 * amount is gross until then, so the cheque is written for the amount after the forecast TDS. Once
 * approved, the amount is already net.
 */
export const tdsStillToWithhold = (status?: string | null): boolean =>
    status === PAYMENT_STATUS.REQUESTED || status === PAYMENT_STATUS.CEO_PENDING;

/** Mirrors `rules.payment_duplicate_problem(made_from=NEW_CHEQUE_FROM_PAYMENT)`: the refusal when the bank + number is already recorded. */
export const newChequeDuplicateText = (existing: Pick<ExistingCheque, "cheque_no" | "bank_label">): string =>
    `Cheque ${existing.cheque_no} (${existing.bank_label}) already exists. This makes a new cheque for the payment. ` +
    `To put this payment on ${existing.cheque_no}, add it to the cheque in Reports, Cheque Payments.`;
