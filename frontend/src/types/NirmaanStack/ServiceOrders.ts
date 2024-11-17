
export interface ServiceOrders{
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
	/**	Service Request : Link - Service Requests	*/
	service_request?: string
	/**	Vendor : Link - Vendors	*/
	vendor?: string
	/**	Service Order List : JSON	*/
	service_order_list?: any
	/**	Status : Data	*/
	status?: string
}