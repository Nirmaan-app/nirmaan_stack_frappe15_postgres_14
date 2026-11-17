import { Category, ProcurementItemWithVendor, RFQData, ProcurementRequestItemDetail } from "./ProcurementRequests"

export type SentBackItem = ProcurementItemWithVendor

export interface SentBackCategory{
	name: string
	creation: string
	modified: string
	doctype: string
	owner: string
	/** Display only: the owner's full name, sent by the list API when it is asked for `owner` (data_table/search.py). */
	owner_name?: string
	modified_by: string
	docstatus?: 0 | 1 | 2
	parent?: string
	parentfield?: string
	parenttype?: string
	idx?: number
	/**	Procurement Request : Link - Procurement Requests	*/
	procurement_request: string
	/**	Project : Link - Projects	*/
	project: string
	/**	Category List : JSON	*/
	category_list:  {
			list: Category[]
		}
	/**	Item List : JSON	*/
	item_list: {
			list: SentBackItem[]
		}
	/**	RFQ Data : JSON	*/
	rfq_data : RFQData
	/**	Type : Data	*/
	type: string
	/**	Comments : Long Text	*/
	comments?: string
	/**	Amended From : Link - Sent Back Category	*/
	amended_from?: string
	workflow_state: string
	order_list: ProcurementRequestItemDetail[]
	payment_terms?: string
}