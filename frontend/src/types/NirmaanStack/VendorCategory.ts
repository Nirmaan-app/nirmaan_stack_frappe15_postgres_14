
export interface VendorCategory{
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
	/**	Vendor : Link - Vendors	*/
	vendor?: string
	/**	Category : Link - Category	*/
	category?: string
}