import { formatToIndianRupeeOrZero } from "@/utils/FormatPrice";
import { TDS_BORNE_BY, type TdsBorneBy } from "@/types/NirmaanStack/PaymentTDSDeduction";

/**
 * *Company Bears TDS* and *Mark as Deposit* (owner 2026-10-27): an Admin puts a Work Order payment cut by
 * its TDS back to its full request before it is paid. Rules on the server: `services/tds_cut_undo`.
 */
export const COMPANY_BEARS_TDS = "Company Bears TDS";
export const MARK_AS_DEPOSIT = "Mark as Deposit";

export type TdsCutUndoAction = "company" | "deposit";

export const TDS_CUT_UNDO_ENDPOINTS: Record<TdsCutUndoAction, string> = {
	company: "nirmaan_stack.api.payments.tds_cut_undo.company_bears_tds",
	deposit: "nirmaan_stack.api.payments.tds_cut_undo.mark_as_deposit",
};

export const TDS_CUT_UNDO_LABELS: Record<TdsCutUndoAction, string> = {
	company: COMPANY_BEARS_TDS,
	deposit: MARK_AS_DEPOSIT,
};

/** The payment row, as the Work Order page holds it. */
export interface TdsCutUndoPayment {
	name: string;
	amount?: number | string;
	status?: string;
	cheque?: string | null;
}

/** The payment's deduction, as `get_work_order_tds` `payments` gives it. */
export interface TdsCutUndoDeduction {
	tds_amount: number;
	borne_by: TdsBorneBy;
	requested_amount?: number;
}

/**
 * Show *Company Bears TDS*? Mirrors `tds_cut_undo.refuse_unless_cut_undoable` (the server checks again, and
 * whether the TDS is paid too): an Admin, an `Approved` payment (its money not yet out) not on a cheque,
 * whose TDS was cut from the vendor and whose amount is still below its full request.
 */
export const canUndoTdsCut = (
	payment: TdsCutUndoPayment,
	deduction: TdsCutUndoDeduction | undefined,
	isAdmin: boolean,
): boolean => {
	if (!isAdmin || !deduction || payment.status !== "Approved" || payment.cheque) return false;
	if (deduction.borne_by !== TDS_BORNE_BY.VENDOR || !deduction.requested_amount) return false;
	return Math.round((Number(payment.amount) || 0) * 100) < Math.round(deduction.requested_amount * 100);
};

/**
 * Show *Mark as Deposit*? On a cut payment, as *Company Bears TDS*; on a TDS the company bears, until the
 * payment is Paid (no payment figure moves, so `Reconciliation Pending` or a cheque doesn't matter). A Paid
 * payment shows neither action (owner 2026-10-27). The server refuses a TDS already paid (in a challan),
 * which this page doesn't know.
 */
export const canMarkAsDeposit = (
	payment: TdsCutUndoPayment,
	deduction: TdsCutUndoDeduction | undefined,
	isAdmin: boolean,
): boolean => {
	if (!isAdmin || !deduction || payment.status === "Paid") return false;
	return deduction.borne_by === TDS_BORNE_BY.COMPANY || canUndoTdsCut(payment, deduction, isAdmin);
};

/** The figures both actions talk about: what the vendor gets now, the full request, and the TDS. */
export const tdsCutFigures = (payment: TdsCutUndoPayment, deduction: TdsCutUndoDeduction) => ({
	amount: formatToIndianRupeeOrZero(Number(payment.amount) || 0),
	request: formatToIndianRupeeOrZero(deduction.requested_amount ?? 0),
	tds: formatToIndianRupeeOrZero(deduction.tds_amount),
});

/** The info-icon text for one action: a headline and its points, with this payment's own figures. */
export const tdsCutUndoHelp = (
	action: TdsCutUndoAction,
	payment: TdsCutUndoPayment,
	deduction: TdsCutUndoDeduction,
): { headline: string; points: string[] } => {
	const f = tdsCutFigures(payment, deduction);
	if (action === "deposit" && deduction.borne_by === TDS_BORNE_BY.COMPANY) {
		return {
			headline: `The vendor's amount stays ${f.amount}: it is already the full request.`,
			points: [
				`The ${f.tds} TDS the company bears is deleted.`,
				"The company won't deposit it.",
				"It won't show in the TDS register or any challan.",
				"Only before the payment and this TDS are paid. Admin only.",
			],
		};
	}
	const headline = `The vendor gets the full request: ${f.request} instead of ${f.amount}.`;
	const tail = "Only before the payment is paid. Admin only.";
	return action === "company"
		? {
			headline,
			points: [
				`The ${f.tds} TDS stays on record.`,
				"The company deposits that TDS from its own pocket.",
				"It still shows in the TDS register and challan.",
				tail,
			],
		}
		: {
			headline,
			points: [
				`The ${f.tds} TDS record is deleted.`,
				"No TDS is deposited for this payment.",
				"It won't show in the TDS register or any challan.",
				tail,
			],
		};
};

/** The confirm dialog's sentence for one action on this payment. */
export const tdsCutUndoConfirmText = (
	action: TdsCutUndoAction,
	payment: TdsCutUndoPayment,
	deduction: TdsCutUndoDeduction,
): string => {
	const f = tdsCutFigures(payment, deduction);
	if (action === "deposit" && deduction.borne_by === TDS_BORNE_BY.COMPANY) {
		return `The ${f.tds} TDS the company bears is deleted. The payment stays ${f.amount}.`;
	}
	return `The payment goes from ${f.amount} back to the full request ${f.request}. ` + (action === "company"
		? `The ${f.tds} TDS stays recorded and is paid by the company.`
		: `The ${f.tds} TDS record is deleted.`);
};
