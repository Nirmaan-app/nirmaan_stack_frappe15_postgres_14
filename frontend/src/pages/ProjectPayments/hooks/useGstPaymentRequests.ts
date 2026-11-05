import { useFrappeDocTypeEventListener, useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";

import type { GSTPaymentRequestRow, GstRequestStatus } from "@/types/NirmaanStack/GSTPaymentRequest";
import {
	APPROVE_GST_REQUEST_API, DELETE_GST_REQUEST_API, GST_REQUESTS_API, REJECT_GST_REQUEST_API, REQUEST_GST_PAYMENT_API,
} from "@/utils/gstPaymentRequests";

/** What to list: one Work Order's requests, or every request at a status (no status: every request). */
export type GstRequestsScope = { workOrder: string } | { status?: GstRequestStatus };

/**
 * GST Payment Requests for a Work Order card or the Accountant's tab, refetched whenever any request
 * changes. `null` scope fetches nothing.
 */
export const useGstPaymentRequests = (scope: GstRequestsScope | null) => {
	const params = scope === null ? undefined
		: "workOrder" in scope ? { work_order: scope.workOrder } : scope.status ? { status: scope.status } : {};
	const key = scope === null ? null : `gst-requests:${JSON.stringify(params)}`;
	const { data, isLoading, error, mutate } = useFrappeGetCall<{ message: GSTPaymentRequestRow[] }>(
		GST_REQUESTS_API, params, key,
	);
	useFrappeDocTypeEventListener("GST Payment Request", () => { if (key) mutate(); });
	return { rows: data?.message ?? [], isLoading, error, mutate };
};

/** Raise, approve, reject and delete: the request endpoints. */
export const useGstRequestActions = () => {
	const { call: request, loading: requesting } = useFrappePostCall<{ message: { name: string } }>(REQUEST_GST_PAYMENT_API);
	const { call: approve, loading: approving } = useFrappePostCall<{
		message: { name: string; project_payment: string; payment_status: string };
	}>(APPROVE_GST_REQUEST_API);
	const { call: reject, loading: rejecting } = useFrappePostCall<{ message: { name: string } }>(REJECT_GST_REQUEST_API);
	const { call: remove, loading: deleting } = useFrappePostCall<{ message: { name: string } }>(DELETE_GST_REQUEST_API);
	return {
		requestGst: (workOrder: string, amount: number) => request({ work_order: workOrder, amount }),
		approveGst: (name: string) => approve({ name }),
		rejectGst: (name: string, comment: string) => reject({ name, comment }),
		deleteGst: (name: string) => remove({ name }),
		busy: requesting || approving || rejecting || deleting,
	};
};
