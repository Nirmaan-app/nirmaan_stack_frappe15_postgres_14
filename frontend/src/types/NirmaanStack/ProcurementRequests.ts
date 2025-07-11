import { Vendor } from "@/pages/ServiceRequests/service-request/select-service-vendor";
export interface ProcurementItemBase {
	name: string;
  item: string;
  unit: string;
  quantity: number;
  category: string;
	work_package?: string;
  make?: string;
  status: string;
  tax? : number;
  comment?: string;
}

export interface ProcurementItemWithVendor extends ProcurementItemBase {
  vendor?: string; // Optional: Vendor ID if selected/quoted
  quote?: number;  // Optional: Quoted amount
}


// The type for items in procurement_list.list
// This could be a union if items can exist with or without vendor details yet
export type ProcurementItem =   ProcurementItemWithVendor;


// export interface ProcurementItem {
//   name: string;
//   item: string;
//   unit: string;
//   quantity: number;
//   category: string;
// 	work_package?: string;
//   vendor?: string;
//   quote?: number;
//   make?: string;
//   status: string;
//   tax? : number;
//   comment?: string;
// }

export interface Category {
  name: string;
  makes?: string[];
}
export interface RFQData {
	selectedVendors: Vendor[];
	details: {
		[itemId: string]: {
			initialMake?: string;
			vendorQuotes: { [vendorId: string]: { quote?: string | number ; make?: string } };
			makes: string[];
		};
	};
}


export interface ProcurementRequestItemDetail {
	name: string;
	creation: string;
	modified: string;
	item_id: string;
	item_name: string;
	unit: string;
	quantity: number;
	category: string;
	procurement_package?: string;
	make?: string;
	status: string;
	tax?: number;
	comment?: string;
	vendor?: string;
	quote?: number;
	parent?: string;
	parentfield?: string;
	parenttype?: string;
}


export interface ProcurementRequest {
	name: string
	creation: string
	modified: string
	doctype: string
	owner: string
	modified_by: string
	docstatus?: 0 | 1 | 2
	parent?: string
	parentfield?: string
	parenttype?: string
	idx?: number
	/**	Project : Link - Projects	*/
	project: string
	/**	Procurement Package : Link - Procurement Packages	*/
	work_package?: string
	/**	Procurement List : JSON	*/
	procurement_list: {
		list: ProcurementItem[]
	}
	/**	Amended From : Link - Procurement Requests	*/
	amended_from?: string
	/**	Category List : JSON	*/
	category_list: {
		list: Category[]
	}
	/**	Comment : Long Text	*/
	comment?: string
	/**	Project Lead : Link - Nirmaan Users	*/
	project_lead?: string
	/**	Procurement Executive : Link - Nirmaan Users	*/
	procurement_executive?: string
	/**	RFQ Data : JSON	*/
	rfq_data: RFQData
	workflow_state: string
	order_list: ProcurementRequestItemDetail[]
}