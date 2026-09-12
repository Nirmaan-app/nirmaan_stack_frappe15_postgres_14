/**
 * One ITNS 281 challan: the receipt for TDS deposited with the Income Tax Department.
 *
 * ⚠️ "TDS" HERE IS **TAX DEDUCTED AT SOURCE**, not the Technical Data Sheet doctypes
 * (`TDS Items`, `TDS Repository`). Same three letters, unrelated concepts.
 *
 * A challan is paid out against `Payment TDS Deduction` rows: each one it covers points back at
 * it via `tds_challan`, and `reconciled_amount` is the sum of those deductions.
 */
export interface TDSChallanAttachment {
	name: string;
	creation: string;
	modified: string;
	owner: string;
	/** As printed on the challan, format YYYY-YY (e.g. 2025-26) — NOT the Assessment Year. */
	financial_year: string;
	/** The challan's face value. Caps how much TDS can be paid against it. */
	amount: number;
	date_of_deposit: string;
	tender_date?: string;
	mode_of_payment?:
		| "Net Banking"
		| "Debit Card"
		| "RTGS/NEFT"
		| "Pay at Bank Counter"
		| "Payment Gateway";
	bank_name?: string;
	/** Part of the duplicate key, stored trimmed + upper-cased. */
	bank_reference_number: string;
	/** Text, not a number — a BSR code can start with 0. */
	bsr_code: string;
	/** Text, not a number — the leading zeros (e.g. 00069) are part of the number. */
	challan_no: string;
	challan_attachment: string;
	/** ⚠️ SERVER-OWNED and read-only: recomputed by `api/tds_challan/pay_tds` as the sum of the
	 *  deductions linked to this challan. The unreconciled balance is `amount - reconciled_amount`,
	 *  derived at the point of use and never stored. */
	reconciled_amount?: number;
}
