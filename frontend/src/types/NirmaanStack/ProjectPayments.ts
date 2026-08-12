
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
	/**	UTR : Data	*/
	utr?: string
	/**	Payment Attachment : Attach	*/
	payment_attachment?: string
	/**	Amount : Data	*/
	amount: number
	/**	TDS : Data	*/
	tds?: number
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