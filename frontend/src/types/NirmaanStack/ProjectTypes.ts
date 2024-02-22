
export interface ProjectTypes{
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
	/**	Project Type Name : Data	*/
	project_type_name: string
	/**	Standard Project Duration : Int	*/
	standard_project_duration?: number
}