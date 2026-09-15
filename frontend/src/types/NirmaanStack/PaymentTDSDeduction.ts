/**
 * Tax Deducted at Source withheld from one Project Payment.
 *
 * ⚠️ "TDS" HERE IS **TAX DEDUCTED AT SOURCE**, not the Technical Data Sheet doctypes
 * (`TDS Items`, `TDS Repository`). Same three letters, unrelated concepts.
 *
 * One row per payment at most — `project_payment` is UNIQUE — created when an SR-backed payment
 * reaches `Approved`. There is no net field: once the row exists,
 * `Project Payments.amount` IS the net figure, so `gross_amount - tds_amount` is the only
 * arithmetic needed and a stored copy could only drift from it.
 */
export interface PaymentTDSDeduction {
	name: string;
	creation: string;
	modified: string;
	owner: string;
	/** Link to Project Payments — UNIQUE */
	project_payment: string;
	/** The payment's parent doctype, snapshotted. Today always "Service Requests". */
	document_type?: string;
	document_name?: string;
	vendor?: string;
	project?: string;
	/** The payment's amount BEFORE tax was withheld — the only surviving record of it. */
	gross_amount: number;
	/** The rate as applied, snapshotted; never re-read from the vendor. */
	tds_percentage: number;
	/** gross_amount x tds_percentage / 100. This is what Service Requests.total_tds sums. */
	tds_amount: number;
	/** The day the payment reached `Approved` and the tax was withheld. Renamed from
	 *  `deducted_on` — same data, truer name. */
	payment_approved_on?: string;
	/** Pending until paid to the department under a challan. Written by the Pay TDS action
	 *  (`api/tds_challan/pay_tds`), never by hand. */
	status?: "Pending" | "Paid";
	/** Link to TDS Challan Attachment — the receipt this tax was deposited under. */
	tds_challan?: string;
}
