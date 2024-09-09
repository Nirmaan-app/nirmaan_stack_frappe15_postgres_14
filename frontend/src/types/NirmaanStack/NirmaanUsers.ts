
export interface NirmaanUsers{
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
	/**	First Name : Data	*/
	first_name: string
	/**	Last name : Data	*/
	last_name?: string
	/**	Full name : Data	*/
	full_name?: string
	/**	Has Project : Data	*/
	has_project?: string
	/**	Mobile : Data	*/
	mobile_no?: string
	/**	Email : Data	*/
	email: string
	/**	Nirmaan Role Name : Data	*/
	role_profile?: string
}