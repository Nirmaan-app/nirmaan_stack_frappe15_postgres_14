import { useFrappeGetCall } from "frappe-react-sdk";
import type { WorkOrderTds } from "../tdsForecast";

/**
 * One Work Order's TDS as the server answers it (`get_work_order_tds`, #1451): the one accessor every
 * screen reads it through. ONE cache key per Work Order (`WorkOrderTds-<id>`), so the Work Order page
 * and the payments pop-up share the answer, and the page's `mutate` after a payment change refreshes both.
 *
 * Asked of the server, which checks read on the Work Order: `Payment TDS Deduction` is readable by the
 * accountants only. `enabled` false (or no Work Order) sends nothing.
 */
export const useWorkOrderTds = (workOrder: string | undefined | null, enabled = true) => {
	const { data, error, mutate } = useFrappeGetCall<{ message: WorkOrderTds }>(
		"nirmaan_stack.api.payments.work_order_tds.get_work_order_tds",
		{ work_order: workOrder },
		enabled && workOrder ? `WorkOrderTds-${workOrder}` : null
	);
	return { workOrderTds: data?.message, error, mutate };
};
