
export interface Customers{
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
	/**	Company Name : Data	*/
	company_name: string
	/**	Company Address : Link - Address	*/
	company_address?: string
	/**	Company Contact Person : Data	*/
	company_contact_person?: string
	/**	Company Phone : Data	*/
	company_phone?: string
	/**	Company Email : Data	*/
	company_email?: string
	/**	Company GST : Data	*/
	company_gst?: string
}