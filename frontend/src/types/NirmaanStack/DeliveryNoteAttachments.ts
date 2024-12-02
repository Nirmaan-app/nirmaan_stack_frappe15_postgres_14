
export interface DeliveryNoteAttachments{
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
	/**	Delivery Note : Link - Procurement Orders	*/
	delivery_note?: string
	/**	Project : Link - Projects	*/
	project?: string
	/**	Image : Attach Image	*/
	image?: string
}