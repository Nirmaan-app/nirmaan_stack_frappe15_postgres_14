/**
 * Tax Deducted at Source withheld from one Project Payment or one Non-Project Expense.
 *
 * ⚠️ "TDS" HERE IS **TAX DEDUCTED AT SOURCE**, not the Technical Data Sheet doctypes
 * (`TDS Items`, `TDS Repository`). Same three letters, unrelated concepts.
 *
 * A row names exactly one of `project_payment` and `non_project_expense` (#1523), and each is
 * UNIQUE, so one payment or expense carries at most one row. A Work Order payment's row is created
 * when its payment is approved. There is no net field: once the row exists,
 * `Project Payments.amount` IS the net figure, so `gross_amount - tds_amount` is the only
 * arithmetic needed and a stored copy could only drift from it.
 */
export interface PaymentTDSDeduction {
	name: string;
	creation: string;
	modified: string;
	owner: string;
	/** Link to Project Payments — UNIQUE. Empty on a Non-Project Expense row. */
	project_payment?: string;
	/** Link to Non Project Expenses — UNIQUE. Set on an Office Rent row, empty on a Work Order row. */
	non_project_expense?: string;
	/** The payment's parent doctype, snapshotted. Today always "Service Requests". */
	document_type?: string;
	document_name?: string;
	vendor?: string;
	project?: string;
	/** Who the tax was withheld from when not a Vendor record (an Office Rent expense's landlord),
	 *  snapshotted at withholding. Empty on a Work Order row, which names its vendor. */
	deductee_name?: string;
	deductee_pan?: string;
	/** The Income Tax section, set once when the row is created: 194C (Work Order payment) or
	 *  194-I (Office Rent expense). Mirrors `services/payment_tds.TDS_SECTIONS`. */
	tds_section?: "194C" | "194-I";
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
	borne_by?: "Vendor" | "Company";
	/** The day the payment reached `Approved` and the tax was withheld. Renamed from
	 *  `deducted_on` — same data, truer name. */
	payment_approved_on?: string;
	/** Pending until paid to the department under a challan. Written by the Pay TDS action
	 *  (`api/tds_challan/pay_tds`), never by hand. */
	status?: "Pending" | "Paid";
	/** Link to TDS Challan Attachment — the receipt this tax was deposited under. */
	tds_challan?: string;
}
