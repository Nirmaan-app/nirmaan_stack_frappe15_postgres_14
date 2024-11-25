
export interface ProjectEstimates{
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
	/**	Work Package : Link - Procurement Packages	*/
	work_package?: string
	/**	Category : Link - Category	*/
	category?: string
	/**	Item : Link - Items	*/
	item?: string
	/**	Item Name : Long Text	*/
	item_name?: string
	/**	UOM : Data	*/
	uom?: string
	/**	Quantity Estimate : Data	*/
	quantity_estimate?: string
	/**	Rate Estimate : Data	*/
	rate_estimate?: string
	/**	Item Tax : Data	*/
	item_tax?: string
}