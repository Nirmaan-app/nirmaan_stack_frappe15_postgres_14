
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
	/**	Procurement Request : Data	*/
	procurement_request?: string
	/**	Category : Data	*/
	category?: string
	/**	Item List : JSON	*/
	item_list?: any
}