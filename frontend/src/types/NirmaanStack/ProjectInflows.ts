export interface ProjectInflows{
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
	/**	Project : Link - Projects	*/
	project: string
	/**	Customer : Link - Customers	*/
	customer: string
	/**	Amount : Data	*/
	amount: number
	/**	Payment Date : Data	*/
	payment_date: string
	/**	Inflow Attachment : Data	*/
	inflow_attachment: string
  /** UTR : Data */
  utr: string
}