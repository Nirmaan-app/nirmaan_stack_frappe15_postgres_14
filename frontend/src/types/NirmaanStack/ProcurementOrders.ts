
export interface ProcurementOrders{
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
	/**	Project : Link - Projects	*/
	project?: string
	/**	Vendor : Link - Vendors	*/
	vendor?: string
	/**	Procurement Request : Link - Procurement Requests	*/
	procurement_request?: string
	/**	Attachment : Data	*/
	attachment?: string
}