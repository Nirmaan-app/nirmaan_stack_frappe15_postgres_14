
export interface NirmaanComments{
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
	/**	Comment Type : Data	*/
	comment_type?: string
	/**	Content : Data	*/
	content?: string
	/**	Subject : Data	*/
	subject?: string
	/**	Reference Doctype : Link - DocType	*/
	reference_doctype?: string
	/**	Reference Name : Dynamic Link	*/
	reference_name?: string
	/**	Comment By : Data	*/
	comment_by?: string
}