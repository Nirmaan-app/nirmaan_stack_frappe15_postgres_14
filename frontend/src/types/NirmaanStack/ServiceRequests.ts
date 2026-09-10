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
	/** Amount Paid : Currency — derived, sum of this SR's Paid payments. NET of tax withheld,
	 * because Project Payments.amount on an SR is stored net (services/payment_tds.py). */
	amount_paid?: string
	/** Total TDS : Currency — derived, tax withheld from this SR's PAID payments. Same population
	 * as amount_paid, recomputed in the same pass. Gross paid = amount_paid + total_tds. */
	total_tds?: number
	/** Amount Due : Currency — derived, total_amount - amount_paid - total_tds (NOT amount_invoiced) */
	amount_due?: number
	/** Is Finalized : Check */
	is_finalized?: 0 | 1
	/** Finalized By : Data (stores full name) */
	finalized_by?: string
	/** Finalized On : Datetime */
	finalized_on?: string
}