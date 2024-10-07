
export interface MilestoneAttachments{
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
	/**	Milestone : Link - Project Work Milestones	*/
	milestone?: string
	/**	Project : Link - Projects	*/
	project?: string
	/**	Area Name : Data	*/
	area_name?: string
	/**	Area Status : Data	*/
	area_status?: string
	/**	Image : Attach Image	*/
	image?: string
}