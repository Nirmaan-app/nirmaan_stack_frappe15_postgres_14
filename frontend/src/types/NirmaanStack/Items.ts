
export interface Items{
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
	/**	Item Name : Data	*/
	item_name: string
	/**	Description : Data	*/
	description?: string
	/**	Unit Name : Data	*/
	unit_name: string
	/**	Make Name : Data	*/
	make_name?: string
	/**	Image Url : Data	*/
	image_url?: string
	/**	Category : Link - Category	*/
	category: string
}