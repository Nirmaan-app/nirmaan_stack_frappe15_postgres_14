
export interface ScopesofWork{
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
	/**	Scope of Work Name : Data	*/
	scope_of_work_name: string
	/**	Work Package : Link - Work Packages	*/
	work_package: string
}