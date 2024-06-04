
export interface Milestones{
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
	/**	Milestone Name : Data	*/
	milestone_name: string
	/**	Scope of Work : Link - Scopes of Work	*/
	scope_of_work?: string
}