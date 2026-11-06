/**
 * A GST Payment Request row as `get_gst_payment_requests` returns it: the request plus what its screens
 * show beside it (server: `nirmaan_stack/api/payments/gst_payment_requests.py`).
 */
export type GstRequestStatus = "Pending" | "Approved" | "Rejected" | "Paid";

export interface GSTPaymentRequestRow {
	name: string;
	work_order: string;
	project: string;
	vendor: string;
	amount: number;
	status: GstRequestStatus;
	/** The requester. */
	owner: string;
	creation: string;
	reviewed_by: string | null;
	reviewed_on: string | null;
	review_comment: string | null;
	/** The GST payment an approval created. */
	project_payment: string | null;
	raised_by_name: string;
	reviewed_by_name: string | null;
	vendor_name: string;
	vendor_gst: string;
	vendor_gst_hold: 0 | 1;
	project_name: string;
}
