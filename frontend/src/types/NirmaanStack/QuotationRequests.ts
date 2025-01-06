
export interface QuotationRequests{
	name: string
	creation: string
	modified: string
	owner: string
	modified_by: string
	docstatus: 0 | 1 | 2
	parent?: string
	parentfield?: string
	parenttype?: string
	idx?: number
	/**	Procurement Task : Link - Procurement Requests	*/
	procurement_task?: string
	/**	Category : Link - Category	*/
	category?: string
	/**	Item : Link - Items	*/
	item?: string
	/**	Vendor : Link - Vendors	*/
	vendor?: string
	/**	City : Data	*/
	city?: string
	/**	State : Data	*/
	state?: string
	/**	Lead Time : Data	*/
	lead_time?: string
	/**	Quantity : Data	*/
	quantity?: string
	/**	Quote : Data	*/
	quote?: string
	/**	Comments : Data	*/
	comments?: string
	/**	Attachment : Data	*/
	attachment?: string
	/**	Status : Data	*/
	status?: string
	/**	Makes : JSON	*/
	makes?: any
}