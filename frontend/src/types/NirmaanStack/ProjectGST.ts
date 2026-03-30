
export interface ProjectGST {
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
	/**	GST Name : Data	*/
	gst_name: string
	/**	GSTIN : Data	*/
	gstin: string
	/**	Address : Small Text	*/
	address?: string
	/**	City : Data	*/
	city?: string
	/**	State : Data	*/
	state?: string
	/**	Pincode : Data	*/
	pincode?: string
}
