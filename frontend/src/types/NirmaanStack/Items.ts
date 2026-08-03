
export interface Items {
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
	/**	Item Name : Data	*/
	item_name: string
	/**	Description : Data	*/
	description?: string
	/**	Unit Name : Data	*/
	unit_name: string
	/**	Make Name : Data	*/
	make_name?: string
	/**	Image Url : Attach	*/
	image_url?: string
	/**	Category : Link - Category	*/
	category: string
	item_status?: "Active" | "Inactive"
	/**	Billing Category : Data	*/
	billing_category?: string
	/**	Linked TDS Item : Link - TDS Items

		The item's ONE TDS datasheet group (ADR-0004, N:1 membership owned by the
		Item). A group's members are derived live as
		`Items WHERE linked_tds_item = <group>` — this field is the SOLE store,
		not a mirror of the retired `TDS Items Child Table`.	*/
	linked_tds_item?: string
}