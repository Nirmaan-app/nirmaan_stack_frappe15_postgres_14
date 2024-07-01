
export interface ProcurementRequests{
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
	/**	Work Package : Link - Work Packages	*/
	work_package?: string
	/**	Procurement List : JSON	*/
	procurement_list?: any
	/**	Amended From : Link - Procurement Requests	*/
	amended_from?: string
	/**	Category List : JSON	*/
	category_list?: any
	/**	Project Lead : Link - Nirmaan Users	*/
	project_lead?: string
	/**	Procurement Executive : Link - Nirmaan Users	*/
	procurement_executive?: string
	workflow_state: string
}