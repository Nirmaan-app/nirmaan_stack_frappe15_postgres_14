import { Vendor } from "@/components/service-request/select-service-vendor";

export interface ProcurementItem {
  name: string;
  item: string;
  unit: string;
  quantity: number;
  category: string;
  vendor?: string;
  quote?: number;
  make?: string;
  status: string;
  tax? : number;
  comment?: string;
}

export interface Category {
  name: string;
  makes: string[];
}

export interface RFQData {
	selectedVendors: Vendor[];
	details: {
		[itemId: string]: {
			vendorQuotes: { [vendorId: string]: { quote?: number; make?: string } };
			makes: string[];
		};
	};
}


export interface ProcurementRequest {
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
}