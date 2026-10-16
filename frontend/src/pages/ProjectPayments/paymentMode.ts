/**
 * Mode of Payment on a Project Payment request — Online or Cheque (owner, 2026-09-19).
 *
 * A cheque is already written when it is requested, so it is captured on the request and it skips
 * "Payment need to paid": once approved (and its Work Order TDS withheld, as for any payment) the
 * server moves it straight on to Reconciliation Pending. The rule lives in
 * `services/cheque_payments.py`; this module only shapes the request and reads the row.
 *
 * Since #1414 (spec #1407) a cheque request starts from the cheque's photo, and the server makes the
 * payment's own new one-line Cheque from it (`api/payments/payment_cheque.py`).
 */

import { CHEQUE_BANK, type ChequeBank } from "@/types/NirmaanStack/Cheques";
import { parseNumber } from "@/utils/parseNumber";

import type { TdsForecast } from "./tdsForecast";

export const PAYMENT_MODE_ONLINE = "Online";
export const PAYMENT_MODE_CHEQUE = "Cheque";
export type PaymentMode = typeof PAYMENT_MODE_ONLINE | typeof PAYMENT_MODE_CHEQUE;

/**
 * The dialog's own state. The cheque fields carry the cheque form's names (`chequePhoto.ts`), so
 * the photo reader fills them. `cheque_date` is the `<input type="date">` value, `YYYY-MM-DD`;
 * `amount` is what the cheque is written for, as its input holds it.
 */
export interface PaymentModeValue {
	mode: PaymentMode;
	bank: ChequeBank;
	/** The printed bank name, for an Others bank only. */
	bank_name: string;
	cheque_no: string;
	cheque_date: string;
	amount: number | string;
	/** The uploaded cheque photo's file URL; empty until it is uploaded. */
	attachment: string;
	/** True while the photo uploads or is read: the fields may still change under the user. */
	photoBusy: boolean;
}

export const EMPTY_PAYMENT_MODE: PaymentModeValue = {
	mode: PAYMENT_MODE_ONLINE,
	bank: CHEQUE_BANK.ICICI,
	bank_name: "",
	cheque_no: "",
	cheque_date: "",
	amount: "",
	attachment: "",
	photoBusy: false,
};

/**
 * Does Request Payment on this record offer Cheque? Only on a PO: a Work Order payment is paid Online
 * (spec #1477). The server refuses the same (`services/cheques/rules.cheque_mode_problem`).
 */
export const chequeModeOffered = (docType: string): boolean => docType === "Procurement Orders";

/** What the create endpoints take (`create_payment_request_for_service`, `create_project_payment`). */
export interface PaymentModeArgs {
	mode_of_payment: PaymentMode;
	bank?: ChequeBank;
	bank_name?: string;
	cheque_no?: string;
	cheque_date?: string;
	cheque_amount?: number;
	cheque_attachment?: string;
}

/**
 * Online needs nothing more. A cheque needs its photo (uploaded and read), the bank (and its name
 * for Others), number, date and an amount, and a bank + number not already recorded: `duplicateOf` is
 * the Cheque that has them (`useDuplicateChequeOf`), "" when none. The server refuses the same
 * (`payment_cheque.refuse_unless_cheque_can_be_made`).
 */
export const isPaymentModeComplete = (v: PaymentModeValue, duplicateOf: string): boolean =>
	v.mode !== PAYMENT_MODE_CHEQUE ||
	(!v.photoBusy &&
		!duplicateOf &&
		v.attachment !== "" &&
		(v.bank !== CHEQUE_BANK.OTHERS || v.bank_name.trim() !== "") &&
		v.cheque_no.trim() !== "" &&
		v.cheque_date.trim() !== "" &&
		parseNumber(v.amount) > 0);

export const paymentModeArgs = (v: PaymentModeValue): PaymentModeArgs =>
	v.mode === PAYMENT_MODE_CHEQUE
		? {
				mode_of_payment: PAYMENT_MODE_CHEQUE,
				bank: v.bank,
				...(v.bank === CHEQUE_BANK.OTHERS ? { bank_name: v.bank_name.trim() } : {}),
				cheque_no: v.cheque_no.trim(),
				cheque_date: v.cheque_date,
				cheque_amount: parseNumber(v.amount),
				cheque_attachment: v.attachment,
			}
		: { mode_of_payment: PAYMENT_MODE_ONLINE };

/** Was this payment requested as a cheque? Blank (every payment before the field) reads as Online. */
export const isChequePayment = (row?: { mode_of_payment?: string | null } | null): boolean =>
	(row?.mode_of_payment || "").trim() === PAYMENT_MODE_CHEQUE;

/**
 * What this payment's cheque is written for. A cheque requested here pays this one payment (#1414);
 * joining several payments on one cheque is done from Reports, Cheque Payments.
 *
 * ⚠️ AFTER TDS (owner, 2026-09-19). A Work Order payment is netted at approval — ₹50,000 requested
 * at 2% is recorded as ₹49,000 — and the cheque must match what the record will say, or the
 * vendor is overpaid by the tax and reconciliation cannot match the bank line. A company-borne
 * Work Order (Miscellaneous / Transportation only) is not reduced, which `forecastTds` already
 * reflects in its `net`; a Procurement Order has no forecast and is written for the amount.
 */
export const chequeAmountFor = (amount: number, tds: TdsForecast | null): number =>
	tds ? tds.net : amount;

/** Within this much the cheque's amount is taken to match (the Cheque lines' gap rule, spec #1407). */
const AMOUNT_TOLERANCE = 2;

export interface ChequeAmountHint {
	/** `gross`: a Work Order cheque written for the amount before TDS. `differs`: any other gap. */
	kind: "gross" | "differs";
	/** What the cheque should be written for (`chequeAmountFor`). */
	expected: number;
	/** The amount requested. */
	gross: number;
	/** The TDS forecast to be withheld; 0 when none. */
	tds: number;
}

/**
 * The soft warning on the cheque's amount (read off the photo or typed), or null when it matches
 * what the cheque should be written for, within ₹2. Never blocks the request.
 */
export const chequeAmountHint = (
	chequeAmount: number | string,
	requested: number,
	tds: TdsForecast | null
): ChequeAmountHint | null => {
	const amount = parseNumber(chequeAmount);
	if (amount <= 0 || requested <= 0) return null;
	const expected = chequeAmountFor(requested, tds);
	if (Math.abs(amount - expected) <= AMOUNT_TOLERANCE) return null;
	const withheld = tds ? tds.tds : 0;
	const gross = expected !== requested && Math.abs(amount - requested) <= AMOUNT_TOLERANCE;
	return { kind: gross ? "gross" : "differs", expected, gross: requested, tds: withheld };
};

export interface ModeTally {
	count: number;
	total: number;
}

/**
 * A bulk selection split by Mode of Payment, for the confirm dialog's "Mode of Payment" box.
 * Payments only: an expense has no mode and is left out of both lines.
 */
export const paymentModeSummary = (
	rows: ReadonlyArray<{ source?: string; mode_of_payment?: string | null; amount?: number | string }>
): { online: ModeTally; cheque: ModeTally } => {
	const online: ModeTally = { count: 0, total: 0 };
	const cheque: ModeTally = { count: 0, total: 0 };
	for (const r of rows) {
		if (r.source !== "Vendor Payment") continue;
		const tally = isChequePayment(r) ? cheque : online;
		tally.count += 1;
		tally.total += parseNumber(r.amount);
	}
	return { online, cheque };
};
