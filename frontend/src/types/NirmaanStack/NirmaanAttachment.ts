export interface NirmaanAttachment{
	name: string
	attachment: string
	creation: string
	modified: string
	owner: string
	modified_by: string
	docstatus?: 0 | 1 | 2
	parent?: string
	parentfield?: string
	parenttype?: string
	idx?: number
  /**	Project : Link - Projects	*/
	project: string
	/**	Associated Doctype : Link - Doctype (Procurement Requests, Sent Back Category, etc...)	*/
	associated_doctype: string
	/**	Associated Docname : Dynamic Link - associated_doctype	*/
	associated_docname: string
  attachment_type? : string
  /** Attachment Ref : Data - DC Number or MIR Number */
  attachment_ref?: string
  /**	Attachment Link Doctype : Link - Doctype (Category, Vendor, etc...)	*/
	attachment_link_doctype?: string
	/**	Attachment Link Docname : Dynamic Link - attachment_link_doctype	*/
	attachment_link_docname?: string
} 