export interface PurchaseOrderItem {
	name: string;
	item: string;
	unit: string;
	quantity: number;
	received?: number;
  category: string;
	procurement_package?: string;
  quote: number;
  make?: string;
  status: string;
  tax: number;
  comment?: string;
	po?: string;
	makes: {
		list: {
			make: string;
			enabled: string;
		}[]
	}
}

export interface DeliveryItem {
	item_id: string;
	item_name: string;
	unit: string;
	from: number;
	to: number;
}

export interface DeliveryDataType {
	[date: string]: {
		items: DeliveryItem[];
		updated_by: string;
		dc_attachment_id?: string;
	};
}

export interface InvoiceItem {
	invoice_no: string;
	amount: number;
	invoice_attachment_id?: string;
	updated_by: string;
	status?: "Pending" | "Approved" | "Rejected";
}

export interface InvoiceDataType {
	[date: string]: InvoiceItem
}


export interface ProcurementOrder {
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
	/**	Procurement Request : Link - Procurement Requests	*/
	procurement_request: string
	/**	Category : Link - Category	*/
	category?: string
	/**	Merged : Data	*/
	merged?: string
	/**	Attachment : Data	*/
	attachment?: string
	/**	Project Name : Data	*/
	project_name: string
	/**	Project Address : Data	*/
	project_address: string
	/**	Vendor Name : Data	*/
	vendor_name: string
	/**	Vendor Address : Data	*/
	vendor_address: string
	/**	Vendor GST : Data	*/
	vendor_gst?: string
	/**	Project GST : Data	*/
	project_gst?: string
	/**	Order List : JSON	*/
	order_list: {
		list: PurchaseOrderItem[]
	}
	/**	Category List : JSON	*/
	category_list?: any
	/**	Advance : Data	*/
	advance?: string
	/**	Loading Charges : Data	*/
	loading_charges?: number
	/**	Freight Charges : Data	*/
	freight_charges?: number
	/**	Notes : Data	*/
	notes?: string
	/**	Status : Data	*/
	status: string
	/**	Delivery Contact : Data	*/
	delivery_contact?: string
	custom?: string
	delivery_data?: { data: DeliveryDataType }
	invoice_data?: { data: InvoiceDataType }
	dispatch_date?: string | null;
}