
export interface Pincodes{
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
	/**	Pincode : Data	*/
	pincode: string
	/**	City : Data	*/
	city: string
	/**	State : Data	*/
	state: string
}