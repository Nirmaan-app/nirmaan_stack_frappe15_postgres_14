import { InvoiceDataType } from "./ProcurementOrders"

interface ServiceCategoryType {
	name: string
}

export interface ServiceItemType {
	id: string
	category: string
	description: string
	uom: string
	quantity: string | number
	rate?: string | number
}

export interface ServiceRequests{
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
	/**	Project : Link - Projects	*/
	project: string
	/**	Vendor : Link - Vendors	*/
	vendor: string
	/**	Service Order List : JSON	*/
	service_order_list: {
		list : ServiceItemType[]
	}
	/**	Service Category List : JSON	*/
	service_category_list: {
		list : ServiceCategoryType[]
	}
	/**	Status : Data	*/
	status: string
	/**	Notes : JSON	*/
	notes?: any
	/**	GST : Data	*/
	gst?: "true" | "false"
	/**	Advance : Data	*/
	advance?: string
	/**	Project GST : Data	*/
	project_gst?: string
	invoice_data?: {data : InvoiceDataType}

	invoice_no?: string
	invoice_date?: string
}