
export interface Projects{
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
	/**	Project Name : Data	*/
	project_name: string
	/**	Customer : Link - Customers	*/
	customer?: string
	/**	Project Type : Link - Project Types	*/
	project_type?: string
	/**	Project Start Date : Date	*/
	project_start_date?: string
	/**	Project End Date : Date	*/
	project_end_date?: string
	/**	Project Address : Link - Address	*/
	project_address?: string
	/**	Project City : Data	*/
	project_city?: string
	/**	Project State : Data	*/
	project_state?: string
	/**	Project Lead : Data	*/
	project_lead?: string
	/**	Procurement Lead : Data	*/
	procurement_lead?: string
	/**	Design Lead : Data	*/
	design_lead?: string
	/**	Project Manager : Data	*/
	project_manager?: string
	/**	Status : Data	*/
	status?: string
	/**	Project Work Packages : JSON	*/
	project_work_packages?: any
	/**	Project Scopes : JSON	*/
	project_scopes?: any
	/**	Subdivisions : Data	*/
	subdivisions?: string
	/**	Subdivision List : JSON	*/
	subdivision_list?: any
}