
export interface Projects{
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
	/**	Project Name : Data	*/
	project_name: string
	/**	Customer : Link - Customers	*/
	customer?: string
	/**	Project Type : Link - Project Types	*/
	project_type?: string
	/**	Project Start Date : Date	*/
	project_start_date: string
	/**	Project End Date : Date	*/
	project_end_date: string
	/**	Project Duration : Int	*/
	project_duration?: number
	/**	Project Address : Link - Address	*/
	project_address: string
	/**	Project City : Data	*/
	project_city?: string
	/**	Project State : Data	*/
	project_state?: string
	/**	Project Lead : Link - User	*/
	project_lead?: string
	/**	Project Manager : Link - User	*/
	project_manager?: string
	/**	Procurement Executive : Link - User	*/
	procurement_executive?: string
	/**	Design Executive : Link - User	*/
	design_executive?: string
	/**	Project Work Milestones : JSON	*/
	project_work_milestones?: any
	/**	Project Scopes : JSON	*/
	project_scopes?: any
}