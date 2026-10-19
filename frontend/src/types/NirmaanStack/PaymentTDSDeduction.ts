/**
 * `Payment TDS Deduction.borne_by`: who bears one deduction's tax, set once when it is created (#1451).
 * Mirrors `payment_tds.BORNE_BY_VENDOR` / `BORNE_BY_COMPANY` on the server.
 */
export const TDS_BORNE_BY = {
	VENDOR: "Vendor",
	COMPANY: "Company",
} as const;

export type TdsBorneBy = (typeof TDS_BORNE_BY)[keyof typeof TDS_BORNE_BY];

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
	/** Who bears this tax, set once when the deduction is created (#1451). "Vendor": withheld, the
	 *  payment cut to the net. "Company": paid on top, the payment kept whole. Read this, never the
	 *  Work Order's categories. Readable by the accountants only, so the Work Order page asks the
	 *  server instead (`get_work_order_tds`, `get_payment_summary`). */
	borne_by?: TdsBorneBy;
	/** The day the payment reached `Approved` and the tax was withheld. Renamed from
	 *  `deducted_on` — same data, truer name. */
	payment_approved_on?: string;
	/** Pending until paid to the department under a challan. Written by the Pay TDS action
	 *  (`api/tds_challan/pay_tds`), never by hand. */
	status?: "Pending" | "Paid";
	/** Link to TDS Challan Attachment — the receipt this tax was deposited under. */
	tds_challan?: string;
}
