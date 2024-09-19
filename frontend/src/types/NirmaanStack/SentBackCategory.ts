
export interface SentBackCategory{
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
	/**	Project : Link - Projects	*/
	project?: string
	/**	Category List : JSON	*/
	category_list?: any
	/**	Item List : JSON	*/
	item_list?: any
	/**	Type : Data	*/
	type?: string
	/**	Comments : Long Text	*/
	comments?: string
	/**	Amended From : Link - Sent Back Category	*/
	amended_from?: string
}