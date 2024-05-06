
export interface Quotations{
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
	/**	Procurement Order : Link - Procurement Orders	*/
	procurement_order?: string
	/**	Quotation Request : Link - Quotation Requests	*/
	rfq?: string
}