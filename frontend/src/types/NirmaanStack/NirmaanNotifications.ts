
export interface NirmaanNotifications{
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
	/**	Recipient : Link - Nirmaan Users	*/
	recipient?: string
	/**	Recipient Role : Link - Role Profile	*/
	recipient_role?: string
	/**	Sender : Link - Nirmaan Users	*/
	sender?: string
	/**	Title : Data	*/
	title?: string
	/**	Description : Data	*/
	description?: string
	/**	Document : Link - DocType	*/
	document?: string
	/**	DocName : Dynamic Link	*/
	docname?: string
	/**	Project : Link - Projects	*/
	project?: string
	/**	Work Package : Link - Procurement Packages	*/
	work_package?: string
	/**	Seen : Data	*/
	seen?: string
	/**	Action URL : Data	*/
	action_url?: string
	/**	type : Select	*/
	type?: "info" | "warning" | "alert"
	/**	Event Id : Data	*/
	event_id?: string
}