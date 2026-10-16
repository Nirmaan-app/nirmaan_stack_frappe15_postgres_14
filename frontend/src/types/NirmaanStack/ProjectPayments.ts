
export interface ProjectPayments{
	name: string
	creation: string
	modified: string
	owner: string
	modified_by: string
	docstatus?: 0 | 1 | 2
	parent?: string
	parentfield?: string
	parenttype?: string
	idx?: number
	/**	Document Type : Link - DocType	*/
	document_type: string
	/**	Document Name : Dynamic Link	*/
	document_name: string
	/**	Project : Link - Projects	*/
	project: string
	/**	Vendor : Link - Vendors	*/
	vendor?: string
	/**
	 * Pay-to account (read-only, #1437, ADR-0033): the account this payment is paid into, a copy of
	 * the vendor's Payee taken when the payment was first saved (a split balance carries its
	 * parent's). Never re-copied or edited: a changed account means reject and raise again. Blank on a
	 * payment from before it, or when the vendor had no Payee.
	 */
	pay_to_account_name?: string | null
	pay_to_account_number?: string | null
	pay_to_ifsc?: string | null
	pay_to_bank_name?: string | null
	pay_to_bank_branch?: string | null
	/**	UTR : Data	*/
	utr?: string
	/**	Payment Attachment : Attach	*/
	payment_attachment?: string
	/**	Voucher Attachment : Attach	*/
	voucher_attachment?: string
	/**	Amount : Data	*/
	amount: number
	/**
	 * GST Payment : Check (set once, at creation) — 1 on a payment that pays a Work Order's GST only
	 * (ADR-0030). Never taxed. Every older payment reads 0: a base payment.
	 */
	is_gst_payment?: 0 | 1
	/**	Mode of Payment : Select - Online / Cheque. Blank reads as Online. Becomes Cheque when the payment
	 * is put on a Cheque; goes back to Online only once that Cheque is Cancelled (spec #1407). */
	mode_of_payment?: "Online" | "Cheque" | ""
	/**	Cheque No : Data — a cheque only, copied from its Cheque; one cheque may cover several payments */
	cheque_no?: string
	/**	Cheque Date : Date — a cheque only, copied from its Cheque */
	cheque_date?: string
	/**	Cheque : Link - Cheques (read-only) — the Cheque the payment is on, set by the cheques service */
	cheque?: string | null
	/**	On Hold : Check — an Approved payment held back from being paid */
	on_hold?: 0 | 1
	/**
	 * Payment TDS : Link - Payment TDS Deduction (read-only)
	 *
	 * The tax deduction withheld from this payment. A MIRROR, not the authority:
	 * `Payment TDS Deduction.project_payment` is the real link and is UNIQUE, which is what makes
	 * the deduction flow idempotent. Written by `services/payment_tds.write_deduction` when the
	 * deduction is recorded, and repaired on the next save if found blank — never set it by hand.
	 */
	payment_tds?: string
	payment_date?: string
	approval_date?: string
	status: string
	/**	CEO Approval Date : Date	*/
	ceo_approval_date?: string
	/**	Auto Approved : Check	*/
	auto_approved?: 0 | 1
	/**
	 * Split From : Link - Project Payments (read-only)
	 *
	 * Set ONLY on the balance half of a partial CEO approval — the payment this one was split
	 * off from. Blank on every ordinary payment, so its presence IS the "this is a carried-forward
	 * balance" signal.
	 */
	split_from?: string
}