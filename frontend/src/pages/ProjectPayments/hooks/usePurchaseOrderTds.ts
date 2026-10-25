import { useFrappeGetCall } from "frappe-react-sdk";
import type { WorkOrderTds } from "../tdsForecast";

/**
 * One PO's recorded tax per payment as the server answers it (`get_order_payment_tds`, #1534): the tax
 * that counts in its Amount Paid (ADR-0034 Amendment B), shaped as a Work Order's `payments`. A payment
 * still stored gross has none. Asked of the server, which checks read on the PO: `Payment TDS Deduction`
 * is readable by the accountants only. `enabled` false (or no PO) sends nothing.
 */
export const usePurchaseOrderTds = (po: string | undefined | null, enabled = true) => {
	const { data, error } = useFrappeGetCall<{ message: Pick<WorkOrderTds, "payments"> }>(
		"nirmaan_stack.api.payments.work_order_tds.get_order_payment_tds",
		{ document_type: "Procurement Orders", document_name: po },
		enabled && po ? `PurchaseOrderTds-${po}` : null
	);
	return { purchaseOrderTds: data?.message, error };
};
