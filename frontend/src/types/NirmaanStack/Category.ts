
export interface Category{
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
	/**	Category Name : Data	*/
	category_name: string
	/**	Procurement Package : Link - Procurement Packages	*/
	work_package: string
	/**	Image Url : Attach Image	*/
	image_url?: string
	/**	Tax : Data	*/
	tax?: string
	/**	New Items Addition : Data	*/
	new_items?: string
}