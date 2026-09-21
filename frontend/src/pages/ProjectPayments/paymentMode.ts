/**
 * Mode of Payment on a Project Payment request — Online or Cheque (owner, 2026-09-19).
 *
 * A cheque is already written when it is requested, so its number and date are captured on the
 * request and it skips "Payment need to paid": once approved (and its Work Order TDS withheld, as
 * for any payment) the server moves it straight on to Reconciliation Pending. The rule lives in
 * `services/cheque_payments.py`; this module only shapes the request and reads the row.
 */

import { parseNumber } from "@/utils/parseNumber";

import type { TdsForecast } from "./tdsForecast";

export const PAYMENT_MODE_ONLINE = "Online";
export const PAYMENT_MODE_CHEQUE = "Cheque";
export type PaymentMode = typeof PAYMENT_MODE_ONLINE | typeof PAYMENT_MODE_CHEQUE;

/** The dialog's own state. `chequeDate` is the `<input type="date">` value, `YYYY-MM-DD`. */
export interface PaymentModeValue {
	mode: PaymentMode;
	chequeNo: string;
	chequeDate: string;
}

export const EMPTY_PAYMENT_MODE: PaymentModeValue = {
	mode: PAYMENT_MODE_ONLINE,
	chequeNo: "",
	chequeDate: "",
};

/** What the create endpoints take (`create_payment_request_for_service`, `create_project_payment`). */
export interface PaymentModeArgs {
	mode_of_payment: PaymentMode;
	cheque_no?: string;
	cheque_date?: string;
}

/** A cheque needs its number and date before it can be requested; Online needs nothing. */
export const isPaymentModeComplete = (v: PaymentModeValue): boolean =>
	v.mode !== PAYMENT_MODE_CHEQUE || (v.chequeNo.trim() !== "" && v.chequeDate.trim() !== "");

export const paymentModeArgs = (v: PaymentModeValue): PaymentModeArgs =>
	v.mode === PAYMENT_MODE_CHEQUE
		? { mode_of_payment: PAYMENT_MODE_CHEQUE, cheque_no: v.chequeNo.trim(), cheque_date: v.chequeDate }
		: { mode_of_payment: PAYMENT_MODE_ONLINE };

/** Was this payment requested as a cheque? Blank (every payment before the field) reads as Online. */
export const isChequePayment = (row?: { mode_of_payment?: string | null } | null): boolean =>
	(row?.mode_of_payment || "").trim() === PAYMENT_MODE_CHEQUE;

/**
 * This payment's part of the cheque. One cheque may cover several payments (owner, 2026-09-19), and
 * is then written for the sum of theirs.
 *
 * ⚠️ AFTER TDS (owner, 2026-09-19). A Work Order payment is netted at approval — ₹50,000 requested
 * at 2% is recorded as ₹49,000 — and the cheque must match what the record will say, or the
 * vendor is overpaid by the tax and reconciliation cannot match the bank line. A company-borne
 * Work Order (Miscellaneous / Transportation only) is not reduced, which `forecastTds` already
 * reflects in its `net`; a Procurement Order has no forecast and is written for the amount.
 */
export const chequeAmountFor = (amount: number, tds: TdsForecast | null): number =>
	tds ? tds.net : amount;

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
