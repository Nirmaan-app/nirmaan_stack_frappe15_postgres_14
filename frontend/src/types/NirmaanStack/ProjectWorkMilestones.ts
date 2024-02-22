
export interface ProjectWorkMilestones{
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
	/**	Project : Data	*/
	project?: string
	/**	Work Package : Data	*/
	work_package?: string
	/**	Scope of Work : Data	*/
	scope_of_work?: string
	/**	Milestone : Data	*/
	milestone?: string
}