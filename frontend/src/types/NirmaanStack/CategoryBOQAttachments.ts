
export interface CategoryBOQAttachments{
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
	/**	BOQ : Attach	*/
	boq?: string
	/**	Procurement Request : Link - Procurement Requests	*/
	procurement_request?: string
	/**	Category : Link - Category	*/
	category?: string
}