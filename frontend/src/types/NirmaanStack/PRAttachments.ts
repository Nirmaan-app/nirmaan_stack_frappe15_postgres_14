
export interface PRAttachments{
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
	/**	RFQ pdf : Attach Image	*/
	rfq_pdf?: string
	/**	Procurement Request : Link - Procurement Requests	*/
	procurement_request?: string
	/**	Vendor : Link - Vendors	*/
	vendor?: string
}