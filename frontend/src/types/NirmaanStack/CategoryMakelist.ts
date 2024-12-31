
export interface CategoryMakelist{
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
	/**	Category : Link - Category	*/
	category?: string
	/**	Make : Link - Makelist	*/
	make?: string
}