type VendorCategory = {
	categories : string[]
}

export interface Vendors{
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
	/**	Vendor Name : Data	*/
	vendor_name: string
	/**	Vendor Nickname : Data	*/
	vendor_nickname?: string
	/**	Vendor Type : Select	*/
	vendor_type: "Material" | "Service" | "Material & Service"
	/**	Vendor Category : JSON	*/
	vendor_category?: VendorCategory
	/**	Vendor Address : Link - Address	*/
	vendor_address?: string
	/**	Vendor City : Data	*/
	vendor_city?: string
	/**	Vendor State : Data	*/
	vendor_state?: string
	/**	Vendor Contact Person Name : Data	*/
	vendor_contact_person_name?: string
	/**	Vendor Mobile : Data	*/
	vendor_mobile?: string
	/**	Vendor Email : Data	*/
	vendor_email?: string
	/**	Vendor GST : Data	*/
	vendor_gst?: string
	account_name? : string
	account_number?: string | number
	ifsc? : string
	bank_name?: string
	bank_branch?: string
}