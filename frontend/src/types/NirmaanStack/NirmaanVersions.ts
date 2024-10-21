
export interface NirmaanVersions{
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
	/**	Doctype : Link - DocType	*/
	ref_doctype?: string
	/**	Docname : Data	*/
	docname?: string
	/**	Data : JSON	*/
	data?: any
	/**	Previous State : Data	*/
	previous_state?: string
	/**	New State : Data	*/
	new_state?: string
}