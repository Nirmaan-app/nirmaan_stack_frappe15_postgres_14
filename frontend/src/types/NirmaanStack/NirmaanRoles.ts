
export interface NirmaanRoles{
	creation: string
	name: string
	modified: string
	owner: string
	modified_by: string
	docstatus: 0 | 1 | 2
	parent?: string
	parentfield?: string
	parenttype?: string
	idx?: number
	/**	Role Name : Data	*/
	role_name: string
	/**	Role Profile Link : Link - Role Profile	*/
	role_profile_link?: string
}