
export interface NirmaanUserPermissions{
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
	/**	User : Link - Nirmaan Users	*/
	user: string
	/**	Allow : Link - DocType	*/
	allow: string
	/**	For Value : Dynamic Link	*/
	for_value: string
}