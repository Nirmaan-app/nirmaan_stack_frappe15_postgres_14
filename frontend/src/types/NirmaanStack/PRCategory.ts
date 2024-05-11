
export interface PRCategory{
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
	/**	Procurement Request : Link - Procurement Requests	*/
	procurement_request?: string
	/**	Category : Link - Category	*/
	category?: string
	/**	Item List : JSON	*/
	item_list?: any
}