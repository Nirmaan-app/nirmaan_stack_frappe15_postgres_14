/**
 * A Credit PO payment term paid by cheque before its due date (owner, 2026-10-31).
 *
 * Until the due date a Credit term is paid only by a cheque dated on or after it, so the vendor cannot cash it
 * early: Request Payment offers Cheque only and keeps Request disabled while the cheque is dated earlier. From
 * the due date on, the usual request applies, Online or Cheque. The server holds the same rule at the request
 * and again at every approval and cheque date edit (`services/cheques/payment_rules.credit_request_problem`,
 * `credit_cheque_date_problem`); this module only shapes the dialog.
 */

import { format, parseISO } from "date-fns";

import { ADMIN_PROFILE, PMO_EXECUTIVE_PROFILE, PROCUREMENT_PROFILES } from "@/constants/roles";

import { EMPTY_PAYMENT_MODE, PAYMENT_MODE_CHEQUE, type PaymentModeValue } from "./paymentMode";

/** A PO payment term's `payment_type` for credit: paid on or after its `due_date`. */
export const CREDIT_TERM = "Credit";

/** Today, `yyyy-MM-dd`, the day the rule compares with. */
export const todayDay = (): string => format(new Date(), "yyyy-MM-dd");

const dayOf = (value?: string | null): string => (value || "").slice(0, 10);

/**
 * Is this Credit term requested before its due date, so it is paid by cheque only? False for any other term,
 * and for a credit term with no due date (the server refuses that one).
 */
export const isEarlyCreditCheque = (
	term: { payment_type?: string | null; due_date?: string | null } | null | undefined,
	today: string
): boolean => {
	const due = dayOf(term?.due_date);
	return (term?.payment_type || "").trim() === CREDIT_TERM && due !== "" && today < due;
};

/**
 * Who sees Pay by Cheque on a credit term not yet due, on the PO page and on Credit Payments: Admin (the
 * Administrator user reads as Admin), PMO and every Procurement profile (owner, 2026-10-31).
 */
export const PAY_BY_CHEQUE_PROFILES: readonly string[] = [ADMIN_PROFILE, PMO_EXECUTIVE_PROFILE, ...PROCUREMENT_PROFILES];

export const canPayCreditByCheque = (role?: string | null): boolean =>
	!!role && PAY_BY_CHEQUE_PROFILES.includes(role);

/** The dialog's starting value: Cheque for an early credit term, Online otherwise. */
export const startingPaymentMode = (earlyCredit: boolean): PaymentModeValue =>
	earlyCredit ? { ...EMPTY_PAYMENT_MODE, mode: PAYMENT_MODE_CHEQUE } : EMPTY_PAYMENT_MODE;

const shown = (day: string): string => format(parseISO(day), "dd-MMM-yyyy");

/**
 * The refusal shown under an early credit cheque dated before the term's due date, or null. Null while no date
 * is filled in: the date is required anyway, and the dialog says so only once one is typed or read off the photo.
 */
export const creditChequeDateProblem = (chequeDate: string, dueDate: string | null | undefined): string | null => {
	const day = dayOf(chequeDate);
	const due = dayOf(dueDate);
	if (!day || !due || day >= due) return null;
	return (
		`The cheque is dated ${shown(day)}, before this credit term's due date of ${shown(due)}. ` +
		"A credit cheque must be dated on or after the due date."
	);
};

export type DueTone = "due" | "overdue" | "paid";

/** A credit term's due chip on the PO page: its text and how urgent it is. */
export interface DueChip {
	text: string;
	tone: DueTone;
}

/**
 * The due chip of a Credit term due `dueDate` while it is `today` (both `yyyy-MM-dd`; a time is ignored): only
 * the date, "Due 26-Nov-2026", never a day count (owner, 2026-10-31). The tone tells the rest: due until the due
 * date (on the day itself too), overdue once past, paid for a Paid term (`paid`). Null with no due date.
 */
export const creditDueChip = (dueDate: string | null | undefined, today: string, paid: boolean): DueChip | null => {
	const due = dayOf(dueDate);
	if (!due) return null;
	const text = `Due ${shown(due)}`;
	if (paid) return { text, tone: "paid" };
	return { text, tone: due < today.slice(0, 10) ? "overdue" : "due" };
};
