
export interface NirmaanUsers{
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
	/**	First Name : Data	*/
	first_name: string
	/**	Last name : Data	*/
	last_name?: string
	/**	Full name : Data	*/
	full_name?: string
	/**	Phone : Phone	*/
	phone?: string
	/**	Email : Data	*/
	email: string
	/**	Nirmaan Role Name : Data	*/
	nirmaan_role_name?: string
}