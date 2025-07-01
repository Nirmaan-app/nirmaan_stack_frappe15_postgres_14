
// ADD this new interface for the notes
export interface NotePoint {
  note: string;
  // This is a temporary client-side ID, so it's optional
  clientId?: number; 
}

export interface PurchaseOrderItem {
	name: string;
	item_name: string;
	item_id: string;
	unit: string;
	quantity: number;
	received_quantity?: number;
  category: string;
	procurement_package?: string;
  quote: number;
	tota_amount?: number;
	amount?: number;
	note_points?:string;// remove
  make?: string;
  status: string;
  tax: number;
  comment?: string;
	po?: string;
	makes?: string
}

export interface DeliveryItem {
	item_id: string;
	item_name: string;
	unit: string;
	from: number;
	to: number;
}
export interface PaymentTerm {
	name: string;
	label: string;
	percentage: number;
	amount: number;
	status: 'Created' | 'Requested' |'Scheduled'|'Approved'| 'Paid'; 
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
	payment_terms?: PaymentTerm[]
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

	items:PurchaseOrderItem[]
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