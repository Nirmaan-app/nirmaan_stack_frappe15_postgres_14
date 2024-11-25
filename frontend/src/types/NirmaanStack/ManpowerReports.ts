
export interface ManpowerReports{
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
	/**	Project : Link - Projects	*/
	project?: string
	/**	Project Name : Data	*/
	project_name?: string
	/**	Report : JSON	*/
	report?: any
}