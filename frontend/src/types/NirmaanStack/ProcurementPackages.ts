
export interface ProcurementPackages{
	name: string
	creation: string
	modified: string
	owner: string
	modified_by: string
	docstatus?: 0 | 1 | 2
	parent?: string
	parentfield?: string
	parenttype?: string
	idx?: number
	/**	Work Package Name : Data	*/
	work_package_name?: string
	/**	Work Package Image : Attach	*/
	work_package_image?: string
}