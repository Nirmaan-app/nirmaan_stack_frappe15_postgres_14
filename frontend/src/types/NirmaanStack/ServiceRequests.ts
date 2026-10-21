export interface ServiceCategoryType {
	name: string
}

export interface ServiceItemType {
	id: string
	category: string
	description: string
	uom: string
	quantity: string | number
	rate?: string | number
}

export interface WorkOrderItem {
	name: string
	item_name: string
	category: string
	uom: string
	quantity: number
	rate: number
}

export interface ServiceRequests {
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
	/**	Project : Link - Projects	*/
	project: string
	/**	Vendor : Link - Vendors	*/
	vendor: string
	/**	Service Order List : JSON (legacy, kept in dual-write)	*/
	service_order_list?: {
		list: ServiceItemType[]
	}
	/**	Work Order Items : Table - Work Order Items	*/
	work_order_items?: WorkOrderItem[]
	/**	Service Category List : JSON	*/
	service_category_list: {
		list: ServiceCategoryType[]
	}
	/**	Status : Data	*/
	status: string
	/**	Notes : JSON	*/
	notes?: any
	/**	GST : Data	*/
	gst?: "true" | "false"
	/**	Advance : Data	*/
	advance?: string
	/**	Project GST : Data	*/
	project_gst?: string

	invoice_no?: string
	invoice_date?: string
	total_amount?: string
	/** Amount Invoiced (Approved) : Currency — derived, sum of this SR's Approved Vendor Invoices */
	amount_invoiced?: number
	/** GST Invoiced : Currency — derived, sum of Invoice GST Amount over this WO's Approved
	 * Vendor Invoices, recomputed with amount_invoiced (ADR-0030). GST billed, not GST paid. */
	gst_invoiced?: number
	/** Amount Paid : Currency — derived, this SR's Paid payments PLUS the TDS withheld from the vendor
	 * on them, less its Received Vendor Refunds (ADR-0034 Amendment A). Tax the company paid on top is
	 * not in it. The one paid figure: screens read it, never re-add payments or tax. */
	amount_paid?: string
	/** Total TDS : Currency — derived, the tax on this SR's PAID payments' deductions, both kinds
	 * (withheld from the vendor, and paid by the company on top). The withheld part is already inside
	 * amount_paid: NEVER add total_tds onto amount_paid (ratchet P1). For the split, ask the server
	 * (`get_work_order_tds`: withheld, company). */
	total_tds?: number
	/** Amount Due : Currency — derived, total_amount - amount_paid (NOT amount_invoiced) */
	amount_due?: number
	/** Is Finalized : Check */
	is_finalized?: 0 | 1
	/** Finalized By : Data (stores full name) */
	finalized_by?: string
	/** Finalized On : Datetime */
	finalized_on?: string
	/** Approved On : Datetime — the first approval, stamped by that save and never moved after (#1532).
	 * Blank on an old WO whose history holds no approval. */
	approved_on?: string | null
	/** Approved By : Data — the user id (email) of whoever first approved it */
	approved_by?: string | null
}