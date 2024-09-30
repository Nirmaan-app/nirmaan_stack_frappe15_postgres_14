
export interface ApprovedQuotations{
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
	/**	Item ID : Link - Items	*/
	item_id?: string
	/**	Vendor : Link - Vendors	*/
	vendor?: string
	/**	Procurement Order : Link - Procurement Orders	*/
	procurement_order?: string
	/**	Item Name : Data	*/
	item_name?: string
	/**	Unit : Data	*/
	unit?: string
	/**	Quantity : Data	*/
	quantity?: string
	/**	Quote : Data	*/
	quote?: string
	/**	Tax : Data	*/
	tax?: string
	/**	City : Data	*/
	city?: string
	/**	State : Data	*/
	state?: string
}